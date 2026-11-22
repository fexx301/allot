"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  loadOrCreateBrowserVault,
  stampGatewayPayload,
  verifyPlanAgainstLocalRule,
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
    badge: "Flagship · Live Spread Guard",
    title: "$3,500 USDC Remote Salary",
    subtitle: "$1,000 cash floor · 25 bps max drift · AAPL / NVDA / SpaceX / TSLA",
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
    badge: "Refusal · CASH_FLOOR_PROTECTED",
    title: "$850 Freelance Invoice",
    subtitle: "Below $1,000 rent floor → refuses all stock buys, preserves 100% USDC",
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
    badge: "Refusal · BELOW_MIN_NOTIONAL + DeFi Fill",
    title: "$32 Micro-Payout (55 bps Cap)",
    subtitle: "4% leg ($1.28) carries over cleanly while tight legs route DeFi Market",
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
  "bg-emerald-600",
  "bg-slate-800",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-amber-600",
  "bg-cyan-700",
];

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function MiniSparkline({ points, breached }: { points?: number[]; breached: boolean }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 68;
  const h = 22;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible">
      <path
        d={d}
        fill="none"
        stroke={breached ? "#B45309" : "#047857"}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpreadGauge({ driftBps, capBps }: { driftBps: number; capBps: number }) {
  const maxScale = Math.max(80, capBps * 1.6, Math.abs(driftBps) * 1.25);
  const clampedDrift = Math.max(0, Math.min(maxScale, driftBps));
  const capPct = Math.min(98, (capBps / maxScale) * 100);
  const driftPct = Math.min(98, (clampedDrift / maxScale) * 100);
  const breached = driftBps > capBps;

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between font-mono text-[10px] text-stone-500">
        <span>0 bps (Market)</span>
        <span className={breached ? "font-semibold text-amber-800" : "font-semibold text-emerald-700"}>
          Quote {driftBps >= 0 ? "+" : ""}
          {driftBps.toFixed(1)} bps vs cap {capBps} bps
        </span>
      </div>
      <div className="relative mt-1 h-2 w-full rounded-full bg-stone-200">
        <div
          className="h-full rounded-l-full bg-emerald-200/80"
          style={{ width: `${capPct}%` }}
        />
        <div
          className="absolute top-[-2px] h-3 w-0.5 bg-slate-900"
          style={{ left: `${capPct}%` }}
          title={`Max Drift Cap: ${capBps} bps`}
        />
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-xs ${
            breached ? "bg-amber-600" : "bg-emerald-600"
          }`}
          style={{ left: `${Math.max(2, driftPct)}%` }}
        />
      </div>
    </div>
  );
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

  // Stock picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [venueFilter, setVenueFilter] = useState<"dual" | "coinbase" | "robinhood" | "solana" | "all">("dual");

  // Plan & Execution state
  const [plan, setPlan] = useState<CompiledPaydayPlan | null>(null);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [simulateTamper, setSimulateTamper] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execMessage, setExecMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Init browser P-256 signer vault + saved wallet
  useEffect(() => {
    try {
      setVault(loadOrCreateBrowserVault());
      const saved = window.localStorage.getItem("allot.connected.wallet.v1");
      if (saved) setConnectedWallet(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  // Load live 136-stock True Markets catalog
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
        // Resolve exact economicAssetIds from live catalog
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

  // Debounced live Gateway quote compilation whenever inputs change
  useEffect(() => {
    const t = setTimeout(() => {
      compileLivePlan();
    }, 320);
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

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    return catalog.stocks.filter((s) => {
      if (venueFilter === "dual" && !s.supportsClobLimit) return false;
      if (venueFilter === "coinbase" && s.issuer !== "coinbase") return false;
      if (venueFilter === "robinhood" && s.issuer !== "robinhood") return false;
      if (venueFilter === "solana" && !s.chains.includes("solana")) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [catalog, venueFilter, searchQuery]);

  // Client-side tamper test + P-256 verification
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

    // Client-side rule verification before P-256 signing
    if (localVerification && !localVerification.ok) {
      setExecMessage({
        type: "err",
        text: `${localVerification.code}: ${localVerification.reason}`,
      });
      return;
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

        // Sign every returned Gateway payload locally with browser P-256 key!
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
          userHandle: connectedWallet?.handle || "demo-engineer",
          signerPublicKey: vault.publicKeyCompressedHex,
          planStamp,
          plan,
          signedOrders,
        }),
      });
      const execData = await execRes.json();
      if (!execRes.ok) throw new Error(execData.error || "Execution failed");

      router.push(`/receipt/${execData.receipt.receiptId}`);
    } catch (err) {
      setExecMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Signing/execution failed",
      });
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Editorial Hero Header */}
      <section className="rounded-2xl border border-[#E5E4DE] bg-white p-6 shadow-xs sm:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                <Sparkles className="h-3 w-3" />
                {connectedWallet ? "LIVE GATEWAY · NON-CUSTODIAL WALLET" : "LIVE QUOTES · PREVIEW MODE"}
              </span>
              {catalog && (
                <span className="inline-flex items-center rounded-full border border-[#E5E4DE] bg-[#F7F6F2] px-2.5 py-0.5 font-mono text-[11px] text-stone-600">
                  {catalog.totalListings} live stocks · {catalog.dualVenueFlagshipCount} dual-venue CLOB
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Route every USDC paycheck into U.S. stocks — automatically.
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
              Allot is a non-custodial Global 401(k) on True Markets Gateway. Set your rent floor and
              max spread cap once: incoming USDC auto-splits across 136 tokenized U.S. stocks (including
              Apple, NVIDIA, Tesla, and pre-IPO SpaceX), auto-switches drifted weekend spreads to{" "}
              <span className="font-medium text-slate-900">CeFi CLOB limit orders</span>, and never moves
              a cent without your browser&apos;s P-256 signature.
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <button
              onClick={() => setWalletModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-emerald-800"
            >
              <Wallet className="h-4 w-4" />
              {connectedWallet
                ? `Wallet: ${connectedWallet.handle}`
                : "Create Non-Custodial Wallet"}
            </button>
            <Link
              href={`/pay/${connectedWallet?.handle || "demo-engineer"}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-2 text-xs font-medium text-slate-800 transition hover:bg-stone-200/60"
            >
              Open Shareable USDC Paylink
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/receipt/rcpt_live_base_20261122"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-900 transition hover:bg-emerald-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              Verified Live Base Receipt
            </Link>
          </div>
        </div>

        {/* 3 One-Click 60-Second Judge Scenarios */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {SCENARIOS.map((sc) => {
            const active = activeScenario === sc.id;
            return (
              <button
                key={sc.id}
                onClick={() => applyScenario(sc.id)}
                className={`group rounded-xl border p-3.5 text-left transition ${
                  active
                    ? "border-slate-900 bg-[#F7F6F2] ring-1 ring-slate-900"
                    : "border-[#E5E4DE] bg-white hover:border-stone-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                      sc.id === "floor-refusal"
                        ? "bg-indigo-50 text-indigo-800"
                        : sc.id === "dust-and-market"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {sc.badge}
                  </span>
                  {active && <CheckCircle2 className="h-4 w-4 text-slate-900" />}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{sc.title}</div>
                <div className="mt-0.5 text-xs text-stone-600">{sc.subtitle}</div>
              </button>
            );
          })}
        </div>
      </section>

      {catalogError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Catalog error: {catalogError}
        </div>
      )}

      {/* Main Split Workbench: Left Rule Studio | Right Live Execution & Refusal Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT: Paycheck Rule Studio */}
        <section className="space-y-5 lg:col-span-5">
          <div className="rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
                1. Paycheck &amp; Safety Guardrails
              </h2>
              <button
                onClick={() => compileLivePlan()}
                disabled={planLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E5E4DE] px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
              >
                <RefreshCw className={`h-3 w-3 ${planLoading ? "animate-spin" : ""}`} />
                Refresh Live Quotes
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-600">
                  Incoming USDC Paycheck
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-3 py-2 focus-within:border-slate-900 focus-within:bg-white">
                  <span className="font-mono text-sm text-stone-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={incomingUsd}
                    onChange={(e) => setIncomingUsd(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent pl-1 font-mono text-base font-semibold text-slate-900 tabular-nums outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600">
                  Existing Wallet USDC
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-3 py-2 focus-within:border-slate-900 focus-within:bg-white">
                  <span className="font-mono text-sm text-stone-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={existingCashUsd}
                    onChange={(e) => setExistingCashUsd(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent pl-1 font-mono text-base font-semibold text-slate-900 tabular-nums outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Cash Floor Slider */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-800">
                  Protected Rent / Cash Floor
                </span>
                <span className="font-mono font-semibold text-indigo-800 tabular-nums">
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
                className="mt-2 w-full accent-slate-900"
              />
              <p className="mt-1 text-[11px] text-stone-500">
                Hard refusal (<code className="font-mono">CASH_FLOOR_PROTECTED</code>) blocks all buys
                until your USDC cash sits safely above this floor.
              </p>
            </div>

            {/* Drift Guard Slider */}
            <div className="mt-5 border-t border-[#E5E4DE] pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-800">
                  Max Spread Drift Guard (vs Live Market)
                </span>
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
                className="mt-2 w-full accent-amber-700"
              />
              <div className="mt-2 flex items-center justify-between rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-slate-800">
                    Auto-route drifted legs to CeFi CLOB Limit
                  </div>
                  <div className="text-[11px] text-stone-500">
                    Uses <code className="font-mono">economic_asset_id</code> pairing when DeFi spread exceeds cap
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoStageClobLimit}
                  onChange={(e) => setAutoStageClobLimit(e.target.checked)}
                  className="h-4 w-4 accent-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Stock Allocation Basket */}
          <div className="rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
                  2. U.S. Equities Split ({totalWeightPct}%)
                </h2>
                <p className="text-[11px] text-stone-500">
                  {totalWeightPct < 100
                    ? `${(100 - totalWeightPct).toFixed(0)}% of surplus stays in spendable USDC`
                    : totalWeightPct === 100
                      ? "100% of surplus above cash floor allocated"
                      : "Weights exceed 100% — reduce a leg"}
                </p>
              </div>
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-2.5 py-1.5 text-xs font-medium text-slate-900 hover:bg-stone-200/70"
              >
                <Plus className="h-3.5 w-3.5" />
                Add from 136 Stocks
              </button>
            </div>

            {/* Visual Split Bar */}
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-stone-200">
              {legs.map((leg, i) => (
                <div
                  key={leg.economicAssetId}
                  style={{ width: `${Math.min(100, leg.weightPct)}%` }}
                  className={`${BAR_COLORS[i % BAR_COLORS.length]} transition-all`}
                  title={`${leg.symbol}: ${leg.weightPct}%`}
                />
              ))}
            </div>

            {pickerOpen && (
              <div className="mt-3 rounded-xl border border-slate-900/15 bg-[#F7F6F2] p-3">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5E4DE] bg-white px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 text-stone-400" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Apple, NVIDIA, SpaceX, Palantir, SPY…"
                    className="w-full text-xs text-slate-900 outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(
                    [
                      ["dual", "14 Dual-Venue CLOB"],
                      ["coinbase", "Coinbase"],
                      ["robinhood", "Robinhood"],
                      ["solana", "Solana"],
                      ["all", `All (${catalog?.totalUniqueStocks ?? 0})`],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setVenueFilter(k)}
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        venueFilter === k
                          ? "bg-slate-900 text-white"
                          : "bg-white text-stone-600 ring-1 ring-[#E5E4DE]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {catalogLoading ? (
                    <div className="p-2 text-xs text-stone-500">Loading live True Markets catalog…</div>
                  ) : (
                    filteredCatalog.slice(0, 35).map((stock) => (
                      <button
                        key={stock.economicAssetId}
                        onClick={() => addStockToBasket(stock)}
                        className="flex w-full items-center justify-between rounded-lg bg-white px-2.5 py-2 text-left text-xs transition hover:bg-emerald-50"
                      >
                        <div className="flex items-center gap-2">
                          {stock.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={stock.icon}
                              alt={stock.symbol}
                              className="h-5 w-5 rounded-full border border-[#E5E4DE] object-cover"
                            />
                          ) : (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">
                              {stock.symbol.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <span className="font-mono font-semibold text-slate-900">{stock.symbol}</span>
                            <span className="ml-1.5 text-stone-600">{stock.name}</span>
                          </div>
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            stock.supportsClobLimit
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-stone-100 text-stone-600"
                          }`}
                        >
                          {stock.supportsClobLimit ? "CeFi CLOB + DeFi" : `DeFi (${stock.chains[0] || "spot"})`}
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
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2]/60 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`} />
                      {stockMeta?.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={stockMeta.icon}
                          alt={leg.symbol}
                          className="h-6 w-6 shrink-0 rounded-full border border-[#E5E4DE] bg-white object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold text-slate-900">
                            {leg.symbol}
                          </span>
                          {stockMeta?.supportsClobLimit && (
                            <span className="rounded bg-emerald-50 px-1 py-0.5 font-mono text-[9px] font-medium text-emerald-800">
                              CLOB
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-stone-500">{leg.name}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-[#E5E4DE] bg-white px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={leg.weightPct}
                          onChange={(e) =>
                            updateLegWeight(leg.economicAssetId, Number(e.target.value))
                          }
                          className="w-10 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums outline-none"
                        />
                        <span className="ml-0.5 text-xs text-stone-400">%</span>
                      </div>
                      <button
                        onClick={() => removeLeg(leg.economicAssetId)}
                        disabled={legs.length <= 1}
                        className="rounded-lg p-1 text-stone-400 hover:bg-stone-200/70 hover:text-red-600 disabled:opacity-30"
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

        {/* RIGHT: Live Cross-Venue Plan, Refusals & P-256 Signer */}
        <section className="space-y-5 lg:col-span-7">
          {/* Summary Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[#E5E4DE] bg-white p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Protected USDC
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-indigo-900 tabular-nums">
                {plan ? fmtUsd(plan.protectedCashCents) : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-500">
                Floor {fmtUsd(Math.round(cashFloorUsd * 100))}
              </div>
            </div>
            <div className="rounded-2xl border border-[#E5E4DE] bg-white p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                DeFi Market
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-emerald-800 tabular-nums">
                {plan ? fmtUsd(plan.totals.executableMarketCents) : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-500">Instant T+0 fill</div>
            </div>
            <div className="rounded-2xl border border-[#E5E4DE] bg-white p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                CeFi CLOB Limit
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-amber-800 tabular-nums">
                {plan ? fmtUsd(plan.totals.stagedLimitCents) : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-500">Drift-guarded</div>
            </div>
            <div className="rounded-2xl border border-[#E5E4DE] bg-white p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Est. Spread Saved
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                {plan ? `$${plan.totals.estimatedSavingsUsd.toFixed(2)}` : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-500">vs blind weekend swap</div>
            </div>
          </div>

          {/* Live Execution & Refusal Inspector */}
          <div className="rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
                  3. Live Gateway Quote &amp; Deterministic Guard Plan
                </h2>
                <p className="text-xs text-stone-500">
                  Quotes fetched live from <code className="font-mono">POST /v1/gateway/quotes</code>{" "}
                  and checked against <code className="font-mono">/v1/defi/market/prices</code>.
                </p>
              </div>
              {plan && (
                <span
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${
                    plan.planStatus === "REFUSED_CASH_FLOOR"
                      ? "bg-indigo-50 text-indigo-800"
                      : plan.planStatus === "READY_TO_SIGN"
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {plan.planStatus}
                </span>
              )}
            </div>

            {planError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {planError}
              </div>
            )}

            {plan?.planStatus === "REFUSED_CASH_FLOOR" && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" />
                <div>
                  <div className="font-mono text-xs font-semibold text-indigo-900">
                    REFUSAL: CASH_FLOOR_PROTECTED
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-indigo-900/80">
                    Total cash ({fmtUsd(plan.totalCashBeforeCents)}) is at or below your protected
                    rent/bills floor ({fmtUsd(plan.cashFloorCents)}). Allot refused all stock orders
                    and kept 100% of your paycheck liquid in USDC.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              {plan?.legs.map((leg) => {
                const badgeStyle =
                  leg.action === "EXECUTE_DEFI_MARKET"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : leg.action === "STAGE_CEFI_LIMIT"
                      ? "bg-amber-50 text-amber-900 border-amber-200"
                      : leg.reasonCode === "CASH_FLOOR_PROTECTED"
                        ? "bg-indigo-50 text-indigo-800 border-indigo-200"
                        : "bg-stone-100 text-stone-700 border-stone-200";

                return (
                  <div
                    key={leg.economicAssetId}
                    className="rounded-xl border border-[#E5E4DE] bg-[#F7F6F2]/50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        {leg.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={leg.icon}
                            alt={leg.symbol}
                            className="h-8 w-8 rounded-full border border-[#E5E4DE] bg-white object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 font-mono text-xs font-bold text-white">
                            {leg.symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-slate-900">
                              {leg.symbol}
                            </span>
                            <span className="text-xs text-stone-600">{leg.name}</span>
                            <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              {fmtUsd(leg.effectiveCents)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-stone-500 tabular-nums">
                            <span>
                              Market:{" "}
                              {leg.marketPrice ? `$${leg.marketPrice.toFixed(2)}` : "n/a"}
                            </span>
                            <span>·</span>
                            <span>
                              Gateway Quote:{" "}
                              {leg.quotePrice ? `$${leg.quotePrice.toFixed(2)}` : "n/a"}
                            </span>
                            {leg.driftBps !== null && (
                              <>
                                <span>·</span>
                                <span
                                  className={
                                    leg.driftBps > maxDriftBps
                                      ? "font-semibold text-amber-800"
                                      : "font-semibold text-emerald-700"
                                  }
                                >
                                  {leg.driftBps >= 0 ? "+" : ""}
                                  {leg.driftBps.toFixed(1)} bps
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <MiniSparkline
                          points={sparklines[leg.economicAssetId]}
                          breached={leg.driftBps !== null && leg.driftBps > maxDriftBps}
                        />
                        <span
                          className={`rounded-lg border px-2 py-1 font-mono text-[10px] font-semibold ${badgeStyle}`}
                        >
                          {leg.reasonCode === "APPROVED"
                            ? "APPROVED · DEFI MARKET"
                            : leg.action === "STAGE_CEFI_LIMIT"
                              ? "PRICE_DRIFT_GUARDED → CEFI CLOB LIMIT"
                              : leg.reasonCode}
                        </span>
                      </div>
                    </div>

                    {leg.driftBps !== null && leg.reasonCode !== "CASH_FLOOR_PROTECTED" && (
                      <SpreadGauge driftBps={leg.driftBps} capBps={maxDriftBps} />
                    )}

                    <p className="mt-2.5 text-xs leading-relaxed text-stone-700">
                      {leg.reasonMessage}
                    </p>

                    {leg.targetAssetId && leg.orderType && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-[#E5E4DE] bg-white px-3 py-1.5 font-mono text-[11px] text-stone-600">
                        <span className="font-semibold text-slate-900">
                          {leg.targetVenue?.toUpperCase()} {leg.orderType.toUpperCase()}
                        </span>
                        <span>qty={leg.orderQty} ({leg.qtyUnit})</span>
                        {leg.limitPrice && (
                          <span className="text-amber-800">limit=${leg.limitPrice}</span>
                        )}
                        <span className="truncate text-stone-400">
                          asset_id={leg.targetAssetId.slice(0, 12)}…
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Non-Custodial Browser P-256 Signer & Execute Panel */}
          <div className="rounded-2xl border border-slate-900/15 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                  <Lock className="h-3.5 w-3.5" />
                  4. Client-Side ECDSA P-256 Signer Verification
                </div>
                <p className="mt-1 text-xs text-stone-600">
                  Allot&apos;s server holds only the Org API key and{" "}
                  <span className="font-medium text-slate-900">cannot move funds</span>. Your browser
                  verifies the canonical <code className="font-mono">plan_hash</code> against your
                  local Cash Floor &amp; Drift rules before stamping True Markets payloads.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#E5E4DE] bg-[#F7F6F2] px-2.5 py-1.5 text-[11px] font-medium text-stone-700">
                <input
                  type="checkbox"
                  checked={simulateTamper}
                  onChange={(e) => setSimulateTamper(e.target.checked)}
                  className="accent-red-600"
                />
                Test Server Tamper Refusal
              </label>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] p-3 font-mono text-[11px] sm:grid-cols-2">
              <div>
                <span className="text-stone-500">P-256 Key: </span>
                <span className="text-slate-900">{vault?.fingerprint ?? "…"}</span>
              </div>
              <div className="truncate">
                <span className="text-stone-500">plan_hash: </span>
                <span className="text-slate-900">{plan?.planHash.slice(0, 20) ?? "…"}…</span>
              </div>
            </div>

            {localVerification && !localVerification.ok && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-mono font-semibold">{localVerification.code}: </span>
                  {localVerification.reason}
                </div>
              </div>
            )}

            {execMessage && (
              <div
                className={`mt-3 rounded-xl border p-3 text-xs ${
                  execMessage.type === "err"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {execMessage.text}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
              <button
                onClick={() => handleSignAndExecute(true)}
                disabled={executing || !plan || !vault || (localVerification ? !localVerification.ok : false)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-stone-200/70 disabled:opacity-40"
              >
                <KeyRound className="h-4 w-4" />
                Sign Locally (P-256) &amp; Mint Preview Receipt
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
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-emerald-800 disabled:opacity-40"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {executing ? "Signing & Executing Live…" : "Sign & Execute Live on Gateway"}
                </button>
              )}
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
