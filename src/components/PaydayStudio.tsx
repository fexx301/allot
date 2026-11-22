"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  loadOrCreateBrowserVault,
  stampGatewayPayload,
  verifyPlanAgainstLocalRule,
  verifyPreparedOrderQuote,
  type LocalP256SignerVault,
} from "@/lib/allot/signer";
import type { CompiledPaydayPlan, PaycheckRule, SplitLegConfig } from "@/lib/allot/types";
import type { PairedStockAsset } from "@/lib/tm-gateway/types";
import { WalletModal, type ConnectedGatewayWallet } from "./WalletModal";

interface CatalogResponse {
  fetchedAt: string;
  totalListings: number;
  totalUniqueStocks: number;
  dualVenueFlagshipCount: number;
  stocks: PairedStockAsset[];
  pricesByEconomicId: Record<
    string,
    { symbol: string; price: number; timestamp: string } | null
  >;
}

const SCENARIOS = [
  {
    id: "salary-3500",
    tag: "Payday Split",
    title: "$3,500 Remote Salary",
    subtitle: "$1,000 rent floor · 25 bps spread cap · AAPL, NVDA, SpaceX, TSLA",
    incomingUsd: 3500,
    existingCashUsd: 400,
    cashFloorUsd: 1000,
    maxDriftBps: 25,
    minNotionalUsd: 2,
    autoStageClobLimit: true,
    symbols: [
      { symbol: "AAPLC", weightPct: 35 },
      { symbol: "NVDAC", weightPct: 30 },
      { symbol: "SPCXC", weightPct: 20 },
      { symbol: "TSLAC", weightPct: 15 },
    ],
  },
  {
    id: "floor-refusal",
    tag: "Cash Floor Guard",
    title: "$850 Freelance Invoice",
    subtitle: "Below $1,000 rent floor — locks tear-off stub, keeps 100% in USDC",
    incomingUsd: 850,
    existingCashUsd: 100,
    cashFloorUsd: 1000,
    maxDriftBps: 25,
    minNotionalUsd: 2,
    autoStageClobLimit: true,
    symbols: [
      { symbol: "AAPLC", weightPct: 50 },
      { symbol: "NVDAC", weightPct: 50 },
    ],
  },
  {
    id: "dust-and-market",
    tag: "Dust Carryover",
    title: "$32 Micro-Payout",
    subtitle: "$1.28 SpaceX slice rolls forward cleanly while larger legs fill",
    incomingUsd: 32,
    existingCashUsd: 1000,
    cashFloorUsd: 1000,
    maxDriftBps: 55,
    minNotionalUsd: 2,
    autoStageClobLimit: true,
    symbols: [
      { symbol: "AAPLC", weightPct: 60 },
      { symbol: "NVDAC", weightPct: 36 },
      { symbol: "SPCXC", weightPct: 4 },
    ],
  },
];

const BAR_COLORS = [
  "bg-[#701735]",
  "bg-[#171412]",
  "bg-teal-700",
  "bg-amber-700",
  "bg-rose-800",
  "bg-stone-600",
];

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function MiniSparkline({
  id,
  points,
  breached,
}: {
  id: string;
  points?: number[];
  breached: boolean;
}) {
  if (!points || points.length < 2) return null;

  // Downsample gently to ~14 points so 5s weekend plateaus don't create jagged micro-steps
  const targetCount = 14;
  const sampled: number[] = [];
  if (points.length <= targetCount) {
    sampled.push(...points);
  } else {
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.round((i / (targetCount - 1)) * (points.length - 1));
      sampled.push(points[idx]);
    }
  }

  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;

  const rawMin = Math.min(...sampled);
  const rawMax = Math.max(...sampled);
  const mid = (rawMin + rawMax) / 2 || 1;
  // Minimum visual band (0.25% of price) prevents tiny $0.02 wiggles from looking like cliffs
  const minBand = mid * 0.0025;
  const effectiveSpan = Math.max(rawMax - rawMin, minBand);
  const yMin = mid - effectiveSpan / 2;
  const yMax = mid + effectiveSpan / 2;

  const w = 96;
  const h = 30;
  const padX = 4;
  const padY = 5;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const coords = sampled.map((v, i) => ({
    x: padX + (i / (sampled.length - 1)) * innerW,
    y: padY + innerH - ((v - yMin) / (yMax - yMin)) * innerH,
  }));

  // Smooth Catmull-Rom -> Cubic Bezier curve
  let linePath = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = Math.max(2, Math.min(h - 2, p1.y + (p2.y - p0.y) / 6));
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = Math.max(2, Math.min(h - 2, p2.y - (p3.y - p1.y) / 6));
    linePath += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  const lastPt = coords[coords.length - 1];
  const firstPt = coords[0];
  const areaPath = `${linePath} L${lastPt.x.toFixed(1)},${h} L${firstPt.x.toFixed(1)},${h} Z`;

  const stroke = breached ? "#B45309" : pctChange < -0.02 ? "#9F1239" : "#0F766E";
  const gradId = `spark-${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-2.5 py-1 shadow-[0_1px_2px_rgba(23,20,18,0.03)]">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Subtle opening-price baseline */}
        <line
          x1={padX}
          y1={firstPt.y}
          x2={w - padX}
          y2={firstPt.y}
          stroke="#D8D1C5"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Live endpoint halo + dot */}
        <circle cx={lastPt.x} cy={lastPt.y} r="4.5" fill={stroke} fillOpacity="0.18" />
        <circle cx={lastPt.x} cy={lastPt.y} r="2.2" fill={stroke} stroke="#FFFFFF" strokeWidth="1" />
      </svg>
      <div className="flex flex-col items-end font-mono leading-tight tabular-nums">
        <span className="text-[9px] uppercase tracking-wider text-[#625B54]">1h</span>
        <span
          className="text-[10px] font-semibold"
          style={{ color: stroke }}
        >
          {pctChange >= 0 ? "+" : ""}
          {pctChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

function SpreadGauge({ driftBps, capBps }: { driftBps: number; capBps: number }) {
  const maxScale = Math.max(70, capBps * 1.6, Math.abs(driftBps) * 1.25);
  const clampedDrift = Math.max(0, Math.min(maxScale, driftBps));
  const capPct = Math.min(96, (capBps / maxScale) * 100);
  const driftPct = Math.min(97, (clampedDrift / maxScale) * 100);
  const breached = driftBps > capBps;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#625B54]">Live Spread vs Your {capBps} bps Cap</span>
        <span
          className={`font-mono font-semibold tabular-nums ${
            breached ? "text-amber-800" : "text-teal-800"
          }`}
        >
          {driftBps >= 0 ? "+" : ""}
          {driftBps.toFixed(1)} bps
        </span>
      </div>
      <div className="relative mt-1.5 h-2 w-full rounded-full bg-[#ECE8DF]">
        <div
          className="h-full rounded-l-full bg-teal-600/20"
          style={{ width: `${capPct}%` }}
        />
        <div
          className="absolute top-[-3px] h-3.5 w-[2px] rounded-full bg-[#701735]"
          style={{ left: `${capPct}%` }}
          title={`Max Drift Cap: ${capBps} bps`}
        />
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-xs transition-all duration-300 ${
            breached ? "bg-amber-600" : "bg-teal-700"
          }`}
          style={{ left: `${Math.max(2, driftPct)}%` }}
        />
      </div>
    </div>
  );
}

function consumerBadgeForLeg(
  action: CompiledPaydayPlan["legs"][number]["action"],
  limitPrice: string | null,
): { label: string; tone: string } {
  switch (action) {
    case "EXECUTE_DEFI_MARKET":
      return {
        label: "Instant Fill · Base",
        tone: "border-teal-200 bg-teal-50 text-teal-900",
      };
    case "STAGE_CEFI_LIMIT":
      return {
        label: limitPrice ? `Limit Protected @ $${limitPrice}` : "CeFi Limit Protected",
        tone: "border-amber-200 bg-amber-50 text-amber-900",
      };
    case "CARRIED_OVER":
      return {
        label: "Rolled to Next Payday",
        tone: "border-[#EAD2DA] bg-[#F9EFF2] text-[#701735]",
      };
    case "BLOCKED_NO_REFERENCE":
      return {
        label: "Held · No Reference Price",
        tone: "border-rose-200 bg-rose-50 text-rose-900",
      };
    case "BLOCKED_STALE_REFERENCE":
      return {
        label: "Held · Stale Reference",
        tone: "border-rose-200 bg-rose-50 text-rose-900",
      };
    case "BLOCKED_DRIFT_NO_CLOB":
      return {
        label: "Held · Spread Too Wide",
        tone: "border-amber-200 bg-amber-50 text-amber-900",
      };
    default:
      return {
        label: "Held Safely in USDC",
        tone: "border-[#E5E1D8] bg-[#FAF8F4] text-[#625B54]",
      };
  }
}

export function PaydayStudio() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [vault, setVault] = useState<LocalP256SignerVault | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedGatewayWallet | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  // Rule & Paycheck State
  const [activeScenario, setActiveScenario] = useState("salary-3500");
  const [incomingUsd, setIncomingUsd] = useState(3500);
  const [existingCashUsd, setExistingCashUsd] = useState(400);
  const [cashFloorUsd, setCashFloorUsd] = useState(1000);
  const [maxDriftBps, setMaxDriftBps] = useState(25);
  const [minNotionalUsd, setMinNotionalUsd] = useState(2);
  const [autoStageClobLimit, setAutoStageClobLimit] = useState(true);
  const [legs, setLegs] = useState<SplitLegConfig[]>([
    {
      economicAssetId: "3ee17c6c-9940-452d-b7b4-a3b086f6da94",
      symbol: "AAPLC",
      name: "Apple",
      weightPct: 35,
    },
    {
      economicAssetId: "b58e6ba0-ecb9-492b-86c6-4aeba2b201fb",
      symbol: "NVDAC",
      name: "NVIDIA",
      weightPct: 30,
    },
    {
      economicAssetId: "952e41f3-320f-43c3-8ead-ad69c8d4e7a6",
      symbol: "SPCXC",
      name: "SpaceX",
      weightPct: 20,
    },
    {
      economicAssetId: "tsla-placeholder",
      symbol: "TSLAC",
      name: "Tesla",
      weightPct: 15,
    },
  ]);

  // Stock picker & inspector toggle
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [venueFilter, setVenueFilter] = useState<
    "dual" | "coinbase" | "robinhood" | "solana" | "all"
  >("dual");
  const [showGatewayInspector, setShowGatewayInspector] = useState(false);

  // Plan & Execution state
  const [plan, setPlan] = useState<CompiledPaydayPlan | null>(null);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [simulateTamper, setSimulateTamper] = useState(false);
  const [simulatePriceMove, setSimulatePriceMove] = useState(false);
  const [priceMoveRefusal, setPriceMoveRefusal] = useState<{
    symbol: string;
    name: string;
    allocatedCents: number;
    benchmarkPrice: number;
    previewQuotePrice: number | null;
    previewDriftBps: number | null;
    preparedQuotePrice: number | null;
    preparedDriftBps: number | null;
    capBps: number;
    code: string;
    reason: string;
    simulated: boolean;
  } | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execMessage, setExecMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    try {
      setVault(loadOrCreateBrowserVault());
      const saved = window.localStorage.getItem("allot.connected.wallet.v1");
      if (saved) setConnectedWallet(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setCatalogLoading(true);
      try {
        const res = await fetch("/api/catalog");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Catalog load failed");
        if (!active) return;
        setCatalog(data);
        setLegs((prev) =>
          prev.map((l) => {
            const match = (data.stocks as PairedStockAsset[]).find(
              (s) => s.symbol.toUpperCase() === l.symbol.toUpperCase(),
            );
            return match
              ? { ...l, economicAssetId: match.economicAssetId, name: match.name }
              : l;
          }),
        );
      } catch (err) {
        if (active) setCatalogError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        if (active) setCatalogLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const totalWeightPct = useMemo(
    () => Number(legs.reduce((acc, l) => acc + l.weightPct, 0).toFixed(2)),
    [legs],
  );

  const currentRule: PaycheckRule = useMemo(
    () => ({
      ruleId: `allot-${activeScenario}`,
      label: "Allot Paycheck Rule",
      cashFloorCents: Math.round(cashFloorUsd * 100),
      maxDriftBps,
      minNotionalCents: Math.round(minNotionalUsd * 100),
      autoStageClobLimit,
      legs,
    }),
    [activeScenario, cashFloorUsd, maxDriftBps, minNotionalUsd, autoStageClobLimit, legs],
  );

  const compileLivePlan = useCallback(async () => {
    if (legs.length === 0 || totalWeightPct > 100) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incomingUsd,
          existingCashUsd,
          userId: connectedWallet?.userId,
          mode: connectedWallet ? "LIVE_GATEWAY" : "LIVE_QUOTES_PREVIEW",
          rule: currentRule,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Plan compilation failed");
      setPlan(data.plan);
      if (data.sparklinesByEconomicId) setSparklines(data.sparklinesByEconomicId);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Failed to compile plan");
    } finally {
      setPlanLoading(false);
    }
  }, [incomingUsd, existingCashUsd, connectedWallet, currentRule, legs.length, totalWeightPct]);

  useEffect(() => {
    const t = setTimeout(() => {
      compileLivePlan();
    }, 300);
    return () => clearTimeout(t);
  }, [compileLivePlan]);

  function applyScenario(id: string) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) return;
    setActiveScenario(sc.id);
    setIncomingUsd(sc.incomingUsd);
    setExistingCashUsd(sc.existingCashUsd);
    setCashFloorUsd(sc.cashFloorUsd);
    setMaxDriftBps(sc.maxDriftBps);
    setMinNotionalUsd(sc.minNotionalUsd);
    setAutoStageClobLimit(sc.autoStageClobLimit);
    setSimulateTamper(false);
    setSimulatePriceMove(false);
    setPriceMoveRefusal(null);
    setExecMessage(null);
    setLegs(
      sc.symbols.map((item) => {
        const match = catalog?.stocks.find((s) => s.symbol === item.symbol);
        return {
          economicAssetId: match?.economicAssetId || item.symbol,
          symbol: item.symbol,
          name: match?.name || item.symbol,
          weightPct: item.weightPct,
        };
      }),
    );
  }

  function addStockToBasket(stock: PairedStockAsset) {
    if (legs.some((l) => l.economicAssetId === stock.economicAssetId)) return;
    const remaining = Math.max(0, 100 - totalWeightPct);
    const weight = remaining > 0 ? Math.min(10, remaining) : 0;
    setLegs((prev) => [
      ...prev,
      {
        economicAssetId: stock.economicAssetId,
        symbol: stock.symbol,
        name: stock.name,
        weightPct: weight,
      },
    ]);
    setPickerOpen(false);
  }

  function updateLegWeight(economicAssetId: string, weightPct: number) {
    setLegs((prev) =>
      prev.map((l) =>
        l.economicAssetId === economicAssetId
          ? { ...l, weightPct: Math.max(0, Math.min(100, weightPct)) }
          : l,
      ),
    );
  }

  function removeLeg(economicAssetId: string) {
    setLegs((prev) => prev.filter((l) => l.economicAssetId !== economicAssetId));
  }

  function normalizeWeightsTo100() {
    setLegs((prev) => {
      if (prev.length === 0) return prev;
      const sum = prev.reduce((acc, l) => acc + l.weightPct, 0);
      if (sum <= 0) {
        const base = Math.floor(100 / prev.length);
        let rem = 100 - base * prev.length;
        return prev.map((l) => {
          const extra = rem > 0 ? 1 : 0;
          if (rem > 0) rem -= 1;
          return { ...l, weightPct: base + extra };
        });
      }
      const scaled = prev.map((l) => ({
        leg: l,
        raw: (l.weightPct / sum) * 100,
        floor: Math.floor((l.weightPct / sum) * 100),
      }));
      let rem = 100 - scaled.reduce((a, s) => a + s.floor, 0);
      const order = [...scaled]
        .map((s, idx) => ({ idx, frac: s.raw - s.floor }))
        .sort((a, b) => b.frac - a.frac);
      const bonuses = new Set(order.slice(0, Math.max(0, rem)).map((o) => o.idx));
      return scaled.map((s, idx) => ({
        ...s.leg,
        weightPct: s.floor + (bonuses.has(idx) ? 1 : 0),
      }));
    });
  }

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    return catalog.stocks.filter((s) => {
      if (venueFilter === "dual" && !s.supportsClobLimit) return false;
      if (venueFilter === "coinbase" && s.issuer !== "coinbase") return false;
      if (venueFilter === "robinhood" && s.issuer !== "robinhood") return false;
      if (venueFilter === "solana" && !s.chains.includes("solana")) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [catalog, venueFilter, searchQuery]);

  const localVerification = useMemo(() => {
    if (!plan) return null;
    const testedPlan = simulateTamper
      ? { ...plan, cashFloorCents: Math.max(0, plan.cashFloorCents - 50_000) }
      : plan;
    return verifyPlanAgainstLocalRule(testedPlan, currentRule);
  }, [plan, currentRule, simulateTamper]);

  async function handleSignAndExecute(forcePreview: boolean) {
    if (!plan || !vault) return;
    setExecMessage(null);
    setPriceMoveRefusal(null);

    if (localVerification && !localVerification.ok) {
      setExecMessage({
        type: "err",
        text: `${localVerification.code}: ${localVerification.reason}`,
      });
      return;
    }

    // Mid-flight price-move refusal demo: exercises the REAL client verifyPreparedOrderQuote()
    // pre-sign gate before any P-256 signature is emitted.
    if (simulatePriceMove) {
      const targetLeg = plan.legs.find(
        (l) =>
          l.action === "EXECUTE_DEFI_MARKET" &&
          l.marketPrice !== null &&
          l.quotePrice !== null,
      );
      if (!targetLeg || targetLeg.marketPrice === null) {
        setExecMessage({
          type: "err",
          text: "No approved market leg in this plan to test a mid-flight jump — switch to $3,500 Salary or raise the spread cap so at least one stock is approved for Instant Fill.",
        });
        return;
      }

      const jumpedPrice = Number(
        (targetLeg.marketPrice * (1 + (currentRule.maxDriftBps + 40) / 10_000)).toFixed(4),
      );
      const legUsd = targetLeg.effectiveCents / 100;
      const check = verifyPreparedOrderQuote({
        symbol: targetLeg.symbol,
        orderType: "market",
        benchmarkPrice: targetLeg.marketPrice,
        maxDriftBps: currentRule.maxDriftBps,
        preparedQuote: {
          price: jumpedPrice.toFixed(4),
          qty: legUsd.toFixed(2),
          qty_out: (legUsd / jumpedPrice).toFixed(6),
        },
      });

      if (!check.ok) {
        setPriceMoveRefusal({
          symbol: targetLeg.symbol,
          name: targetLeg.name,
          allocatedCents: targetLeg.effectiveCents,
          benchmarkPrice: targetLeg.marketPrice,
          previewQuotePrice: targetLeg.quotePrice,
          previewDriftBps: targetLeg.driftBps,
          preparedQuotePrice: check.preparedPrice,
          preparedDriftBps: check.preparedDriftBps,
          capBps: currentRule.maxDriftBps,
          code: check.code,
          reason: check.reason,
          simulated: true,
        });
        void compileLivePlan();
        return;
      }
    }

    setExecuting(true);
    try {
      const planStamp = await stampGatewayPayload(
        vault,
        JSON.stringify({
          planHash: plan.planHash,
          depositEventId: plan.depositEventId,
          cashFloorCents: plan.cashFloorCents,
          maxDriftBps: currentRule.maxDriftBps,
        }),
      );

      const useLive = !forcePreview && Boolean(connectedWallet);
      const executableLegs = plan.legs.filter(
        (l) =>
          (l.action === "EXECUTE_DEFI_MARKET" || l.action === "STAGE_CEFI_LIMIT") &&
          l.targetAssetId &&
          l.targetVenue &&
          l.orderType &&
          l.qtyUnit &&
          l.orderQty,
      );

      let signedOrders: Array<{
        symbol: string;
        venue: "cefi" | "defi";
        orderType: "market" | "limit";
        orderId: string;
        requestedUsd: number;
        benchmarkPrice?: number;
        driftBps?: number;
        signatures: string[];
      }> = [];

      if (useLive && connectedWallet && executableLegs.length > 0) {
        const prepRes = await fetch("/api/orders/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: connectedWallet.userId,
            orders: executableLegs.map((l) => ({
              symbol: l.symbol,
              venue: l.targetVenue,
              asset_id: l.targetAssetId,
              qty: l.orderQty,
              qty_unit: l.qtyUnit,
              side: "buy",
              type: l.orderType,
              price: l.limitPrice ?? undefined,
            })),
          }),
        });
        const prepData = await prepRes.json();
        if (!prepRes.ok) throw new Error(prepData.error || "Order preparation failed");

        const preparedList = prepData.prepared as Array<{
          symbol: string;
          venue: "cefi" | "defi";
          type: "market" | "limit";
          ok: boolean;
          orderId?: string;
          quote?: { price?: string; qty?: string; qty_out?: string } | null;
          payloads?: Array<{ payload: string }>;
          error?: string;
          issues?: Array<{ code?: string; message?: string }>;
        }>;

        const readyOrders = preparedList.filter((p) => p.ok && p.orderId);
        if (readyOrders.length === 0) {
          const firstErr = preparedList[0];
          const issueText = firstErr?.issues?.map((i) => i.message || i.code).join("; ");
          throw new Error(
            issueText ||
              firstErr?.error ||
              "Wallet needs USDC on Base/Solana for live fills — use Preview Receipt or fund your wallet on the Paylink tab.",
          );
        }

        for (const p of readyOrders) {
          const legMeta = executableLegs.find((l) => l.symbol === p.symbol);
          const check = verifyPreparedOrderQuote({
            symbol: p.symbol,
            orderType: p.type,
            benchmarkPrice: legMeta?.marketPrice ?? null,
            maxDriftBps: currentRule.maxDriftBps,
            preparedQuote: p.quote,
          });
          if (!check.ok) {
            setPriceMoveRefusal({
              symbol: p.symbol,
              name: legMeta?.name ?? p.symbol,
              allocatedCents: legMeta?.effectiveCents ?? 0,
              benchmarkPrice: legMeta?.marketPrice ?? 0,
              previewQuotePrice: legMeta?.quotePrice ?? null,
              previewDriftBps: legMeta?.driftBps ?? null,
              preparedQuotePrice: check.preparedPrice,
              preparedDriftBps: check.preparedDriftBps,
              capBps: currentRule.maxDriftBps,
              code: check.code,
              reason: check.reason,
              simulated: false,
            });
            void compileLivePlan();
            throw new Error(`${check.code}: ${check.reason}`);
          }
        }

        signedOrders = await Promise.all(
          readyOrders.map(async (p) => {
            const legMeta = executableLegs.find((l) => l.symbol === p.symbol);
            const signatures = await Promise.all(
              (p.payloads ?? []).map((item) => stampGatewayPayload(vault, item.payload)),
            );
            return {
              symbol: p.symbol,
              venue: p.venue,
              orderType: p.type,
              orderId: p.orderId!,
              requestedUsd: Number(((legMeta?.effectiveCents ?? 0) / 100).toFixed(2)),
              benchmarkPrice: legMeta?.marketPrice ?? undefined,
              driftBps: legMeta?.driftBps ?? undefined,
              signatures,
            };
          }),
        );
      }

      const execRes = await fetch("/api/orders/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: useLive ? "LIVE_GATEWAY" : "LIVE_QUOTES_PREVIEW",
          userId: connectedWallet?.userId || "98f6006a-b96a-4b77-a9e8-69c1c85c308c",
          userHandle: connectedWallet?.handle || "femi",
          signerPublicKey: vault.publicKeyCompressedHex,
          planStamp,
          plan,
          signedOrders,
        }),
      });
      const execData = await execRes.json();
      if (!execRes.ok) throw new Error(execData.error || "Execution failed");

      router.push(execData.sharePath || `/receipt/${execData.receipt.receiptId}`);
    } catch (err) {
      setExecMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Signing/execution failed",
      });
    } finally {
      setExecuting(false);
    }
  }

  const totalInvestedCents = plan
    ? plan.totals.executableMarketCents + plan.totals.stagedLimitCents
    : 0;
  const floorLocked = plan?.planStatus === "REFUSED_CASH_FLOOR";

  return (
    <div className="space-y-7">
      {/* Editorial Hero Header */}
      <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-3 py-1 text-xs font-medium text-[#701735]">
              {connectedWallet
                ? "Live Non-Custodial Wallet"
                : "Live True Markets Quotes · Preview Mode"}
            </span>
            {catalog && (
              <span className="inline-flex items-center rounded-full border border-[#E5E1D8] bg-white px-3 py-1 font-mono text-[11px] text-[#625B54]">
                {catalog.totalListings} U.S. Stocks · {catalog.dualVenueFlagshipCount} CLOB Limit Pairs
              </span>
            )}
          </div>
          <h1 className="font-serif-display mt-3.5 text-3xl font-semibold tracking-tight text-[#171412] sm:text-4xl">
            Keep your rent safe. Put the rest into U.S. stocks.
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[#625B54]">
            A non-custodial Global 401(k) for stablecoin earners. Set your cash floor and spread
            limit once — every incoming USDC paycheck automatically splits into Apple, NVIDIA,
            SpaceX, and 130+ tokenized equities, never below your floor and never without your
            browser&apos;s P-256 signature.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            onClick={() => setWalletModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#701735] px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-[#581028]"
          >
            <Wallet className="h-4 w-4" />
            {connectedWallet ? `Wallet: ${connectedWallet.handle}` : "Create Wallet"}
          </button>
          <Link
            href="/receipt/rcpt_live_base_20261122"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-4 py-2.5 text-xs font-semibold text-[#701735] transition hover:bg-[#F3DFE6]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Verified Live Base Receipt
          </Link>
          <Link
            href={connectedWallet?.sharePath || `/pay/${connectedWallet?.handle || "femi"}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#E5E1D8] bg-white px-4 py-2.5 text-xs font-medium text-[#171412] transition hover:border-[#701735]/40"
          >
            Share Paylink
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* 3 Tactile Scenario Pills */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SCENARIOS.map((sc) => {
          const active = activeScenario === sc.id;
          return (
            <button
              key={sc.id}
              onClick={() => applyScenario(sc.id)}
              className={`group rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-[#701735] bg-white shadow-sm ring-1 ring-[#701735]"
                  : "border-[#E5E1D8] bg-white/75 hover:border-[#701735]/40 hover:bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    active
                      ? "bg-[#701735] text-white"
                      : "bg-[#F6F4EF] text-[#625B54]"
                  }`}
                >
                  {sc.tag}
                </span>
                {active && <CheckCircle2 className="h-4 w-4 text-[#701735]" />}
              </div>
              <div className="font-serif-display mt-2.5 text-base font-semibold text-[#171412]">
                {sc.title}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-[#625B54]">{sc.subtitle}</div>
            </button>
          );
        })}
      </section>

      {/* SIGNATURE VISUAL MOMENT: Interactive Tear-Off Paycheck Stub */}
      <section className="relative overflow-hidden rounded-3xl border border-[#E5E1D8] bg-white shadow-sm">
        <div className="h-1.5 w-full bg-[#701735]" />
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* LEFT RETAINED STUB: Protected Cash Floor */}
          <div
            className={`relative p-6 sm:p-7 lg:col-span-5 ${
              floorLocked ? "bg-[#F9EFF2]" : "bg-[#FAF8F4]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#701735]">
                Retained Pay Stub · Liquid USDC
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  floorLocked
                    ? "bg-[#701735] text-white"
                    : "border border-[#EAD2DA] bg-white text-[#701735]"
                }`}
              >
                <Lock className="h-3 w-3" />
                {floorLocked ? "Floor Locked" : "Protected"}
              </span>
            </div>

            <div className="mt-5">
              <div className="text-xs text-[#625B54]">Kept safely in your Base/Solana wallet</div>
              {planLoading && !plan ? (
                <div className="skeleton mt-2 h-10 w-40 rounded-lg" />
              ) : (
                <div className="font-serif-display mt-1 text-4xl font-semibold tracking-tight text-[#171412] tabular-nums">
                  {plan ? fmtUsd(plan.protectedCashCents) : fmtUsd(Math.round(cashFloorUsd * 100))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 font-mono text-xs text-[#625B54] tabular-nums">
                <span>Incoming: ${incomingUsd.toLocaleString()}</span>
                <span>·</span>
                <span>Rent Floor: ${cashFloorUsd.toLocaleString()}</span>
              </div>
            </div>

            {/* Subtle check-stub bars echoing the Allot logo */}
            <div className="mt-6 space-y-2 opacity-65">
              <div className="h-2.5 w-3/4 rounded-full bg-[#701735]/15" />
              <div className="h-2.5 w-1/2 rounded-full bg-[#701735]/10" />
            </div>

            {floorLocked && (
              <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[#701735]/25 bg-white p-3.5 text-xs text-[#701735]">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-semibold">Pay stub kept intact.</span> Total cash (
                  {fmtUsd(plan.totalCashBeforeCents)}) is below your {fmtUsd(plan.cashFloorCents)}{" "}
                  rent floor, so Allot refused all stock orders.
                </div>
              </div>
            )}
          </div>

          {/* CENTER PERFORATED TEAR-OFF DIVIDER */}
          <div className="relative flex items-center justify-center border-y border-dashed border-[#D8D1C5] bg-[#F6F4EF] py-2.5 lg:col-span-1 lg:border-x lg:border-y-0 lg:py-0">
            <div className="flex items-center gap-1.5 rounded-full border border-[#EAD2DA] bg-white px-3 py-1 font-mono text-[10px] font-semibold text-[#701735] shadow-xs lg:-rotate-90 lg:whitespace-nowrap">
              <Scissors className="h-3 w-3" />
              {floorLocked
                ? "LOCKED · $0 TORN OFF"
                : `${plan ? fmtUsd(totalInvestedCents) : "…"} ALLOTTED`}
            </div>
          </div>

          {/* RIGHT DETACHABLE STUB: Auto-Allotted U.S. Equities */}
          <div className="flex flex-col justify-between p-6 sm:p-7 lg:col-span-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#625B54]">
                  Detachable Equity Stub · U.S. Stocks (T+0)
                </span>
                {plan && plan.totals.estimatedSavingsUsd > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                    Est. ${plan.totals.estimatedSavingsUsd.toFixed(2)} spread saved
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <div className="text-xs text-[#625B54]">Auto-routed into tokenized equities</div>
                  {planLoading && !plan ? (
                    <div className="skeleton mt-2 h-10 w-44 rounded-lg" />
                  ) : (
                    <div className="font-serif-display mt-1 text-4xl font-semibold tracking-tight text-[#701735] tabular-nums">
                      {plan ? fmtUsd(totalInvestedCents) : "$0.00"}
                    </div>
                  )}
                </div>

                <div className="flex gap-4 font-mono text-xs tabular-nums">
                  <div>
                    <div className="text-[10px] uppercase text-[#625B54]">Instant Fill</div>
                    <div className="font-semibold text-teal-800">
                      {plan ? fmtUsd(plan.totals.executableMarketCents) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#625B54]">Limit Protected</div>
                    <div className="font-semibold text-amber-800">
                      {plan ? fmtUsd(plan.totals.stagedLimitCents) : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Animated Split Bar */}
              <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-[#ECE8DF]">
                {legs.map((leg, i) => (
                  <div
                    key={leg.economicAssetId}
                    style={{ width: floorLocked ? "0%" : `${Math.min(100, leg.weightPct)}%` }}
                    className={`${BAR_COLORS[i % BAR_COLORS.length]} transition-all duration-500`}
                    title={`${leg.symbol}: ${leg.weightPct}%`}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#625B54]">
                {legs.map((leg, i) => (
                  <span key={leg.economicAssetId} className="inline-flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                    />
                    <span className="font-medium text-[#171412]">{leg.name}</span>
                    <span className="font-mono text-[11px]">{leg.weightPct}%</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-4 text-xs text-[#625B54]">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#701735]" />
                Non-custodial · Signed only by your browser P-256 key
              </span>
              <button
                onClick={() => compileLivePlan()}
                disabled={planLoading}
                className="inline-flex items-center gap-1 font-medium text-[#701735] hover:underline"
              >
                <RefreshCw className={`h-3 w-3 ${planLoading ? "animate-spin" : ""}`} />
                Refresh live prices
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 12-Month Transparent Fee Comparison Strip (Legacy FX/Wire vs Allot 0.20% Gateway) */}
      {(() => {
        const monthlyInvestUsd = Math.max(0, totalInvestedCents / 100);
        const annualInflowUsd = monthlyInvestUsd * 12;
        // Legacy global worker path: ~3.8% FX off-ramp/broker spread + $25 international wire per paycheck
        const legacyAnnualFeesUsd = annualInflowUsd > 0 ? annualInflowUsd * 0.038 + 25 * 12 : 0;
        // Verified live True Markets Gateway fee (0.20% observed on mainnet Base fills, $0 gas, T+0)
        const allotAnnualFeesUsd = annualInflowUsd * 0.002;
        const annualFeeSavingsUsd = Math.max(0, legacyAnnualFeesUsd - allotAnnualFeesUsd);

        if (annualInflowUsd <= 0) return null;
        return (
          <section className="rounded-2xl border border-[#E5E1D8] bg-white px-5 py-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-[#F9EFF2] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#701735]">
                  12-Month Fee Comparison
                </span>
                <p className="text-xs text-[#625B54]">
                  At{" "}
                  <strong className="font-mono text-[#171412]">
                    ${monthlyInvestUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}/mo
                  </strong>{" "}
                  invested (${annualInflowUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr):
                  legacy FX off-ramp + wire (~3.8% + $25/mo, T+3) costs{" "}
                  <span className="font-mono text-rose-800 line-through">
                    ${legacyAnnualFeesUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr
                  </span>{" "}
                  vs Allot on True Markets (0.20% verified fee, $0 gas, T+0):{" "}
                  <strong className="font-mono text-teal-800">
                    ${allotAnnualFeesUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr
                  </strong>
                  .
                </p>
              </div>
              <div className="shrink-0 font-mono text-sm font-semibold text-[#701735] tabular-nums">
                +${annualFeeSavingsUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr kept
                in U.S. stocks
              </div>
            </div>
          </section>
        );
      })()}

      {catalogError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Catalog error: {catalogError}
        </div>
      )}

      {/* Main Two-Column Workbench: Left Rule Studio | Right Execution & P-256 Sign */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT: Paycheck Rule Studio */}
        <section className="space-y-5 lg:col-span-5">
          <div className="rounded-2xl border border-[#E5E1D8] bg-white p-5 shadow-xs">
            <h2 className="font-serif-display text-lg font-semibold text-[#171412]">
              Paycheck &amp; Protection Rules
            </h2>
            <p className="mt-0.5 text-xs text-[#625B54]">
              Adjust your income, rent floor, or max spread cap to watch live True Markets routing
              update instantly.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#625B54]">
                  Incoming Paycheck
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] px-3 py-2 focus-within:border-[#701735] focus-within:bg-white">
                  <span className="font-mono text-sm text-[#625B54]">$</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={incomingUsd}
                    onChange={(e) => setIncomingUsd(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent pl-1 font-mono text-base font-semibold text-[#171412] tabular-nums outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#625B54]">
                  Existing Wallet USDC
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] px-3 py-2 focus-within:border-[#701735] focus-within:bg-white">
                  <span className="font-mono text-sm text-[#625B54]">$</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={existingCashUsd}
                    onChange={(e) => setExistingCashUsd(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent pl-1 font-mono text-base font-semibold text-[#171412] tabular-nums outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Cash Floor Slider */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#171412]">Protected Cash Floor</span>
                <span className="font-mono font-semibold text-[#701735] tabular-nums">
                  ${cashFloorUsd.toLocaleString()} USDC
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={3000}
                step={50}
                value={cashFloorUsd}
                onChange={(e) => setCashFloorUsd(Number(e.target.value))}
                className="allot-slider mt-2.5 w-full"
              />
              <p className="mt-1.5 text-[11px] text-[#625B54]">
                Rent and bills come first — zero stock buys happen until your cash exceeds this
                reserve.
              </p>
            </div>

            {/* Drift Guard Slider */}
            <div className="mt-5 border-t border-[#E5E1D8] pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#171412]">Max Spread Drift Cap</span>
                <span className="font-mono font-semibold text-amber-800 tabular-nums">
                  {maxDriftBps} bps ({(maxDriftBps / 100).toFixed(2)}%)
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={maxDriftBps}
                onChange={(e) => setMaxDriftBps(Number(e.target.value))}
                className="allot-slider allot-slider-amber mt-2.5 w-full"
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {(
                  [
                    [5, "Strict 5 bps · Trigger Limit"],
                    [25, "Balanced 25 bps"],
                    [60, "Wide 60 bps"],
                  ] as const
                ).map(([bps, label]) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => setMaxDriftBps(bps)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      maxDriftBps === bps
                        ? "bg-amber-700 text-white shadow-xs"
                        : "border border-[#E5E1D8] bg-[#FAF8F4] text-[#625B54] hover:border-amber-700/40 hover:text-[#171412]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="mt-2.5 flex cursor-pointer items-center justify-between rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] px-3 py-2.5">
                <div>
                  <div className="text-xs font-medium text-[#171412]">
                    Switch wide spreads to resting limit orders
                  </div>
                  <div className="text-[11px] text-[#625B54]">
                    Avoids weekend AMM slippage by parking a price-capped CeFi CLOB order
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoStageClobLimit}
                  onChange={(e) => setAutoStageClobLimit(e.target.checked)}
                  className="h-4 w-4 accent-[#701735]"
                />
              </label>
            </div>
          </div>

          {/* Equity Split Basket */}
          <div className="rounded-2xl border border-[#E5E1D8] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-serif-display text-lg font-semibold text-[#171412]">
                  U.S. Stock Basket ({totalWeightPct}%)
                </h2>
                <p className="text-xs text-[#625B54]">
                  {totalWeightPct < 100
                    ? `${(100 - totalWeightPct).toFixed(0)}% of surplus stays liquid in USDC`
                    : totalWeightPct === 100
                      ? "100% of surplus above cash floor invested"
                      : "Weights exceed 100% — trim a leg"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {totalWeightPct !== 100 && (
                  <button
                    type="button"
                    onClick={normalizeWeightsTo100}
                    className="rounded-full border border-[#E5E1D8] bg-[#FAF8F4] px-2.5 py-1.5 text-[11px] font-medium text-[#171412] transition hover:border-[#701735]/40 hover:text-[#701735]"
                  >
                    Auto-Balance 100%
                  </button>
                )}
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-3 py-1.5 text-xs font-medium text-[#701735] transition hover:bg-[#F3DFE6]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Stock
                </button>
              </div>
            </div>

            {pickerOpen && (
              <div className="mt-3.5 rounded-2xl border border-[#EAD2DA] bg-[#FAF8F4] p-3">
                <div className="flex items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-[#625B54]" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search 136 U.S. stocks (Apple, NVIDIA, SpaceX, SPY…)"
                    className="w-full text-xs text-[#171412] outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["dual", "14 CLOB Limit"],
                      ["coinbase", "Coinbase"],
                      ["robinhood", "Robinhood"],
                      ["solana", "Solana"],
                      ["all", `All (${catalog?.totalUniqueStocks ?? 0})`],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setVenueFilter(k)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        venueFilter === k
                          ? "bg-[#701735] text-white"
                          : "bg-white text-[#625B54] ring-1 ring-[#E5E1D8]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 max-h-52 space-y-1 overflow-y-auto">
                  {catalogLoading ? (
                    <div className="p-2 text-xs text-[#625B54]">Loading live catalog…</div>
                  ) : (
                    filteredCatalog.slice(0, 35).map((stock) => (
                      <button
                        key={stock.economicAssetId}
                        onClick={() => addStockToBasket(stock)}
                        className="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-xs transition hover:bg-[#F9EFF2]"
                      >
                        <div className="flex items-center gap-2.5">
                          {stock.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={stock.icon}
                              alt={stock.symbol}
                              className="h-5 w-5 rounded-full border border-[#E5E1D8] object-cover"
                            />
                          ) : (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#701735] text-[9px] font-bold text-white">
                              {stock.symbol.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <span className="font-mono font-semibold text-[#171412]">
                              {stock.symbol}
                            </span>
                            <span className="ml-1.5 text-[#625B54]">{stock.name}</span>
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                            stock.supportsClobLimit
                              ? "bg-teal-50 text-teal-800"
                              : "bg-[#F6F4EF] text-[#625B54]"
                          }`}
                        >
                          {stock.supportsClobLimit
                            ? "CLOB + DeFi"
                            : stock.chains[0] || "spot"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2.5">
              {legs.map((leg, i) => {
                const stockMeta = catalog?.stocks.find(
                  (s) => s.economicAssetId === leg.economicAssetId || s.symbol === leg.symbol,
                );
                return (
                  <div
                    key={leg.economicAssetId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] px-3.5 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                      />
                      {stockMeta?.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={stockMeta.icon}
                          alt={leg.symbol}
                          className="h-6 w-6 shrink-0 rounded-full border border-[#E5E1D8] bg-white object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[#171412]">{leg.name}</span>
                          <span className="font-mono text-[11px] text-[#625B54]">{leg.symbol}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-[#E5E1D8] bg-white px-2 py-1 focus-within:border-[#701735]">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={leg.weightPct}
                          onChange={(e) =>
                            updateLegWeight(leg.economicAssetId, Number(e.target.value))
                          }
                          className="w-10 text-right font-mono text-xs font-semibold text-[#171412] tabular-nums outline-none"
                        />
                        <span className="ml-0.5 text-xs text-[#625B54]">%</span>
                      </div>
                      <button
                        onClick={() => removeLeg(leg.economicAssetId)}
                        disabled={legs.length <= 1}
                        className="rounded-lg p-1 text-[#625B54] hover:bg-stone-200/70 hover:text-rose-700 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* RIGHT: Execution Plan & Non-Custodial Browser Signing */}
        <section className="space-y-5 lg:col-span-7">
          <div className="rounded-2xl border border-[#E5E1D8] bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-serif-display text-lg font-semibold text-[#171412]">
                  Live Payday Execution Plan
                </h2>
                <p className="text-xs text-[#625B54]">
                  Real-time prices and execution quotes from True Markets Gateway.
                </p>
              </div>
              <button
                onClick={() => setShowGatewayInspector((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  showGatewayInspector
                    ? "border-[#701735] bg-[#F9EFF2] text-[#701735]"
                    : "border-[#E5E1D8] bg-[#FAF8F4] text-[#625B54] hover:text-[#171412]"
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                {showGatewayInspector ? "Hide API Payloads" : "Inspect Gateway Payloads"}
              </button>
            </div>

            {planError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                {planError}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {!plan && planLoading
                ? [1, 2, 3].map((n) => <div key={n} className="skeleton h-28 w-full rounded-2xl" />)
                : plan?.legs.map((leg) => {
                    const badge = consumerBadgeForLeg(leg.action, leg.limitPrice);
                    return (
                      <div
                        key={leg.economicAssetId}
                        className="rounded-2xl border border-[#E5E1D8] bg-[#FAF8F4]/70 p-4 transition hover:border-[#701735]/30"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {leg.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={leg.icon}
                                alt={leg.symbol}
                                className="h-9 w-9 rounded-full border border-[#E5E1D8] bg-white object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#701735] font-mono text-xs font-bold text-white">
                                {leg.symbol.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-[#171412]">
                                  {leg.name}
                                </span>
                                <span className="font-mono text-xs text-[#625B54]">
                                  {leg.symbol}
                                </span>
                                <span className="font-mono text-sm font-semibold text-[#171412] tabular-nums">
                                  {fmtUsd(leg.effectiveCents)}
                                </span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#625B54] tabular-nums">
                                <span>
                                  Ref: {leg.marketPrice ? `$${leg.marketPrice.toFixed(2)}` : "n/a"}
                                </span>
                                <span>·</span>
                                <span>
                                  Quote: {leg.quotePrice ? `$${leg.quotePrice.toFixed(2)}` : "n/a"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            <MiniSparkline
                              id={leg.economicAssetId}
                              points={sparklines[leg.economicAssetId]}
                              breached={leg.driftBps !== null && leg.driftBps > maxDriftBps}
                            />
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badge.tone}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>

                        {leg.driftBps !== null && leg.reasonCode !== "CASH_FLOOR_PROTECTED" && (
                          <SpreadGauge driftBps={leg.driftBps} capBps={maxDriftBps} />
                        )}

                        <p className="mt-2.5 text-xs leading-relaxed text-[#625B54]">
                          {leg.reasonMessage}
                        </p>

                        {showGatewayInspector && (
                          <div className="mt-3 rounded-xl border border-[#E5E1D8] bg-white p-3 font-mono text-[11px] text-[#575049]">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <span>
                                code=<strong className="text-[#701735]">{leg.reasonCode}</strong>
                              </span>
                              <span>action={leg.action}</span>
                              {leg.targetVenue && (
                                <span>
                                  venue={leg.targetVenue} ({leg.orderType})
                                </span>
                              )}
                              {leg.orderQty && (
                                <span>
                                  qty={leg.orderQty} ({leg.qtyUnit})
                                </span>
                              )}
                              {leg.limitPrice && <span>limit=${leg.limitPrice}</span>}
                            </div>
                            <div className="mt-1 truncate text-[10px] text-stone-400">
                              economic_asset_id={leg.economicAssetId}
                              {leg.targetAssetId ? ` · asset_id=${leg.targetAssetId}` : ""}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
            </div>
          </div>

          {/* Non-Custodial P-256 Authorization Card */}
          <div className="rounded-2xl border border-[#EAD2DA] bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#701735]">
                  <Lock className="h-3.5 w-3.5" />
                  Non-Custodial Browser Authorization
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[#625B54]">
                  Allot&apos;s backend cannot move a cent on its own. Your browser verifies the
                  exact cash floor, spread cap, and prepared Gateway quote before signing with your
                  local P-256 key.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#E5E1D8] bg-[#FAF8F4] px-3 py-1.5 text-[11px] font-medium text-[#625B54] transition hover:border-[#701735]/40">
                  <input
                    type="checkbox"
                    checked={simulateTamper}
                    onChange={(e) => {
                      setSimulateTamper(e.target.checked);
                      if (e.target.checked) setPriceMoveRefusal(null);
                    }}
                    className="accent-rose-700"
                  />
                  Test Tamper Refusal
                </label>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                    simulatePriceMove
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-[#E5E1D8] bg-[#FAF8F4] text-[#625B54] hover:border-amber-600/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={simulatePriceMove}
                    onChange={(e) => {
                      setSimulatePriceMove(e.target.checked);
                      if (!e.target.checked) setPriceMoveRefusal(null);
                    }}
                    className="accent-amber-700"
                  />
                  Test Price-Move Refusal
                </label>
              </div>
            </div>

            {simulatePriceMove && !priceMoveRefusal && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Price-move test armed:</strong> clicking Sign simulates a{" "}
                  <span className="font-mono font-semibold">
                    +{currentRule.maxDriftBps + 40} bps
                  </span>{" "}
                  worse Gateway quote when the order is prepared, exercising{" "}
                  <code className="font-mono">verifyPreparedOrderQuote()</code> before signing so
                  your USDC stays untouched.
                </span>
              </div>
            )}

            {showGatewayInspector && (
              <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] p-3 font-mono text-[11px] sm:grid-cols-2">
                <div>
                  <span className="text-[#625B54]">P-256 Key: </span>
                  <span className="text-[#171412]">{vault?.fingerprint ?? "…"}</span>
                </div>
                <div className="truncate">
                  <span className="text-[#625B54]">plan_hash: </span>
                  <span className="text-[#171412]">{plan?.planHash.slice(0, 22) ?? "…"}…</span>
                </div>
              </div>
            )}

            {localVerification && !localVerification.ok && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-mono font-semibold">{localVerification.code}: </span>
                  {localVerification.reason}
                </div>
              </div>
            )}

            {priceMoveRefusal && (
              <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50/80 p-4 text-xs text-amber-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-amber-800" />
                    <span className="font-mono font-semibold text-amber-900">
                      {priceMoveRefusal.code}
                    </span>
                    <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-amber-900">
                      {priceMoveRefusal.simulated
                        ? "Simulated Mid-Flight Move · Real Client Gate"
                        : "Live Gateway Prepared Quote Drift"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSimulatePriceMove(false);
                      setPriceMoveRefusal(null);
                    }}
                    className="font-medium text-[#701735] underline hover:text-[#581028]"
                  >
                    Clear &amp; Sign Normally
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="rounded-xl border border-teal-200 bg-white p-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-teal-800">
                      1. Preview Quote (OK)
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-[#171412] tabular-nums">
                      {priceMoveRefusal.symbol}{" "}
                      {priceMoveRefusal.previewQuotePrice !== null
                        ? `$${priceMoveRefusal.previewQuotePrice.toFixed(2)}`
                        : "—"}
                    </div>
                    <div className="font-mono text-[11px] text-teal-800 tabular-nums">
                      {priceMoveRefusal.previewDriftBps !== null
                        ? `${priceMoveRefusal.previewDriftBps >= 0 ? "+" : ""}${priceMoveRefusal.previewDriftBps.toFixed(1)} bps ≤ ${priceMoveRefusal.capBps} bps cap`
                        : "Inside cap"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-rose-200 bg-white p-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-rose-800">
                      2. Prepared Order (Worse)
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-rose-900 tabular-nums">
                      {priceMoveRefusal.symbol}{" "}
                      {priceMoveRefusal.preparedQuotePrice !== null
                        ? `$${priceMoveRefusal.preparedQuotePrice.toFixed(2)}`
                        : "—"}
                    </div>
                    <div className="font-mono text-[11px] text-rose-800 tabular-nums">
                      {priceMoveRefusal.preparedDriftBps !== null
                        ? `+${priceMoveRefusal.preparedDriftBps.toFixed(1)} bps > ${priceMoveRefusal.capBps} bps cap`
                        : "Exceeded cap"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#EAD2DA] bg-[#F9EFF2] p-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#701735]">
                      3. Worker Protected
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-[#701735] tabular-nums">
                      {fmtUsd(priceMoveRefusal.allocatedCents)} in USDC
                    </div>
                    <div className="text-[11px] text-[#701735]">
                      0 P-256 signatures sent · Re-quoted
                    </div>
                  </div>
                </div>

                <p className="mt-2.5 text-[11px] leading-relaxed text-amber-900">
                  {priceMoveRefusal.reason}
                </p>
              </div>
            )}

            {execMessage && (
              <div
                className={`mt-3 rounded-xl border p-3 text-xs ${
                  execMessage.type === "err"
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-teal-200 bg-teal-50 text-teal-900"
                }`}
              >
                {execMessage.text}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E1D8] pt-4">
              <span className="font-mono text-[11px] text-[#625B54]">
                Signer: {vault?.fingerprint ?? "Initializing…"}
              </span>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => handleSignAndExecute(true)}
                  disabled={
                    executing ||
                    !plan ||
                    !vault ||
                    (localVerification ? !localVerification.ok : false)
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-[#701735] px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-[#581028] disabled:opacity-40"
                >
                  <KeyRound className="h-4 w-4" />
                  {simulatePriceMove
                    ? "Trigger Price-Move Refusal Test"
                    : "Sign Locally & Mint Receipt"}
                </button>

                {connectedWallet && (
                  <button
                    onClick={() => handleSignAndExecute(false)}
                    disabled={
                      executing ||
                      !plan ||
                      plan.planStatus !== "READY_TO_SIGN" ||
                      (localVerification ? !localVerification.ok : false)
                    }
                    className="inline-flex items-center gap-2 rounded-full bg-teal-800 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-teal-900 disabled:opacity-40"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {executing ? "Executing Live…" : "Execute Live on Gateway"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <WalletModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        vault={vault}
        connectedWallet={connectedWallet}
        onConnected={(w) => setConnectedWallet(w)}
      />
    </div>
  );
}
