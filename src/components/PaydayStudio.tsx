"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  KeyRound,
  Loader2,
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
import { SCENARIOS } from "./payday/scenarios";
import {
  BAR_COLORS,
  MiniSparkline,
  SpreadGauge,
  consumerBadgeForLeg,
  fmtPct,
  fmtUsd,
  plainLegSummary,
} from "./payday/legParts";
import { useTweenedNumber } from "./payday/useTweenedNumber";
import { FeeComparisonStrip } from "./payday/FeeComparisonStrip";
import { PriceMoveRefusalPanel, type PriceMoveRefusal } from "./payday/PriceMoveRefusalPanel";

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
  const [priceMoveRefusal, setPriceMoveRefusal] = useState<PriceMoveRefusal | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executingLive, setExecutingLive] = useState(false);
  const uid = useId();
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
      const marketLeg = plan.legs.find(
        (l) =>
          l.action === "EXECUTE_DEFI_MARKET" &&
          l.marketPrice !== null &&
          l.quotePrice !== null,
      );
      // On weekends live spreads often exceed the default 0.25% cap (all legs staged as
      // limit orders). Fall back to the first allocated leg with a live market price using an
      // in-cap preview baseline so the demo still exercises verifyPreparedOrderQuote().
      const targetLeg =
        marketLeg ??
        plan.legs.find(
          (l) =>
            (l.action === "STAGE_CEFI_LIMIT" || l.action === "BLOCKED_DRIFT_NO_CLOB") &&
            l.effectiveCents > 0 &&
            l.marketPrice !== null,
        );
      if (!targetLeg || targetLeg.marketPrice === null) {
        setExecMessage({
          type: "err",
          text: "Nothing is scheduled to buy in this plan — switch to $3,500 Remote Salary to test a price jump before signing.",
        });
        return;
      }

      const previewDriftBps =
        marketLeg && marketLeg.driftBps !== null
          ? marketLeg.driftBps
          : Number(Math.min(10, currentRule.maxDriftBps / 2).toFixed(1));
      const previewQuotePrice =
        marketLeg && marketLeg.quotePrice !== null
          ? marketLeg.quotePrice
          : Number((targetLeg.marketPrice * (1 + previewDriftBps / 10_000)).toFixed(4));

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
          previewQuotePrice,
          previewDriftBps,
          preparedQuotePrice: check.preparedPrice,
          preparedDriftBps: check.preparedDriftBps,
          capBps: currentRule.maxDriftBps,
          code: check.code,
          reason: check.reason,
          simulated: true,
        });
        document.getElementById("sign-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  const tweenedInvestedCents = useTweenedNumber(totalInvestedCents);
  const tweenedProtectedCents = useTweenedNumber(
    plan ? plan.protectedCashCents : Math.round(cashFloorUsd * 100),
  );
  const signBlocked =
    execMessage?.type === "err" ||
    priceMoveRefusal !== null ||
    (localVerification !== null && !localVerification.ok);

  return (
    <div className="space-y-7">
      {/* Editorial Hero Header */}
      <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-3 py-1 text-xs font-medium text-brand-ink">
              {connectedWallet
                ? "Live Non-Custodial Wallet"
                : "Live True Markets Quotes · Preview Mode"}
            </span>
          </div>
          <h1 className="font-serif-display mt-3.5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Keep your rent safe. Put the rest into U.S. stocks.
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">
            A Global 401(k) for people paid in USDC. Set how much cash to keep and how much price
            slippage you&apos;ll accept, once. Every paycheck then splits into Apple, NVIDIA, SpaceX
            and 130+ other U.S. stocks. Nothing moves below your floor, and nothing moves without
            your approval.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            onClick={() => setWalletModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-brand-hover"
          >
            <Wallet aria-hidden className="h-4 w-4" />
            {connectedWallet ? `Wallet: ${connectedWallet.handle}` : "Create Wallet"}
          </button>
          <Link
            href="/receipt/rcpt_live_base_20261122"
            className="inline-flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
            See a real receipt
          </Link>
          <Link
            href={connectedWallet?.sharePath || `/pay/${connectedWallet?.handle || "femi"}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2.5 text-xs font-medium text-ink transition hover:border-brand-ink/40"
          >
            Share Paylink
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* 3 Tactile Scenario Pills */}
      <section aria-label="Example paydays" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SCENARIOS.map((sc) => {
          const active = activeScenario === sc.id;
          return (
            <button
              key={sc.id}
              type="button"
              aria-pressed={active}
              onClick={() => applyScenario(sc.id)}
              className={`group rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-brand-ink bg-surface shadow-sm ring-1 ring-brand-ink"
                  : "border-line bg-surface/75 hover:border-brand-ink/40 hover:bg-surface"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                    active
                      ? "bg-brand text-white"
                      : "bg-canvas text-ink-muted"
                  }`}
                >
                  {sc.tag}
                </span>
                {active && <CheckCircle2 aria-hidden className="h-4 w-4 text-brand-ink" />}
              </div>
              <div className="font-serif-display mt-2.5 text-base font-semibold text-ink">
                {sc.title}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{sc.subtitle}</div>
            </button>
          );
        })}
      </section>

      {/* SIGNATURE VISUAL MOMENT: Interactive Tear-Off Paycheck Stub */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* LEFT RETAINED STUB: Protected Cash Floor */}
          <div
            className={`relative p-6 sm:p-7 lg:col-span-5 ${
              floorLocked ? "bg-brand-soft" : "bg-paper"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-brand-ink">
                Kept as cash · USDC
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  floorLocked
                    ? "bg-brand text-white"
                    : "border border-brand-border bg-surface text-brand-ink"
                }`}
              >
                <Lock className="h-3 w-3" />
                {floorLocked ? "Floor Locked" : "Protected"}
              </span>
            </div>

            <div className="mt-5">
              <div className="text-xs text-ink-muted">Stays in your wallet for rent and bills</div>
              {planLoading && !plan ? (
                <div className="skeleton mt-2 h-10 w-40 rounded-lg" />
              ) : (
                <div className="font-serif-display mt-1 text-4xl font-semibold tracking-tight text-ink tabular-nums">
                  {fmtUsd(tweenedProtectedCents)}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 font-mono text-xs text-ink-muted tabular-nums">
                <span>Incoming: ${incomingUsd.toLocaleString()}</span>
                <span>·</span>
                <span>Rent Floor: ${cashFloorUsd.toLocaleString()}</span>
              </div>
            </div>

            {floorLocked && (
              <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-brand-ink/25 bg-surface p-3.5 text-xs text-brand-ink">
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
          <div className="relative flex items-center justify-center border-y border-dashed border-line-strong bg-canvas py-2.5 lg:col-span-1 lg:border-x lg:border-y-0 lg:py-0">
            <div className="flex items-center gap-1.5 rounded-full border border-brand-border bg-surface px-3 py-1 font-mono text-[11px] font-semibold text-brand-ink shadow-xs lg:-rotate-90 lg:whitespace-nowrap">
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
                <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
                  Invested · U.S. stocks
                </span>
                {plan && plan.totals.estimatedSavingsUsd > 0 && (
                  <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-800">
                    Est. ${plan.totals.estimatedSavingsUsd.toFixed(2)} spread saved
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <div className="text-xs text-ink-muted">Goes into tokenized U.S. stocks today</div>
                  {planLoading && !plan ? (
                    <div className="skeleton mt-2 h-10 w-44 rounded-lg" />
                  ) : (
                    <div className="font-serif-display mt-1 text-4xl font-semibold tracking-tight text-brand-ink tabular-nums">
                      {fmtUsd(tweenedInvestedCents)}
                    </div>
                  )}
                </div>

                <div className="flex gap-4 font-mono text-xs tabular-nums">
                  <div>
                    <div className="text-[11px] uppercase text-ink-muted">Buying now</div>
                    <div className="font-semibold text-teal-800 dark:text-teal-300">
                      {plan ? fmtUsd(plan.totals.executableMarketCents) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-ink-muted">Limit orders</div>
                    <div className="font-semibold text-amber-800 dark:text-amber-300">
                      {plan ? fmtUsd(plan.totals.stagedLimitCents) : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Animated Split Bar */}
              <div aria-hidden className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-track">
                {legs.map((leg, i) => (
                  <div
                    key={leg.economicAssetId}
                    style={{ width: floorLocked ? "0%" : `${Math.min(100, leg.weightPct)}%` }}
                    className={`${BAR_COLORS[i % BAR_COLORS.length]} transition-all duration-500`}
                    title={`${leg.symbol}: ${leg.weightPct}%`}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                {legs.map((leg, i) => (
                  <span key={leg.economicAssetId} className="inline-flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                    />
                    <span className="font-medium text-ink">{leg.name}</span>
                    <span className="font-mono text-xs">{leg.weightPct}%</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-ink-muted">
              <span className="flex items-center gap-1.5">
                <ShieldCheck aria-hidden className="h-4 w-4 text-brand-ink" />
                Only you can approve. Signed in your browser.
              </span>
              <button
                type="button"
                onClick={() => compileLivePlan()}
                disabled={planLoading}
                className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
              >
                <RefreshCw aria-hidden className={`h-3 w-3 ${planLoading ? "animate-spin" : ""}`} />
                Refresh live prices
              </button>
            </div>
          </div>
        </div>
      </section>

      <FeeComparisonStrip totalInvestedCents={totalInvestedCents} />

      {catalogError && (
        <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-900 dark:text-rose-200">
          Couldn&apos;t load the stock list: {catalogError}
        </div>
      )}

      {/* Main Two-Column Workbench: Left Rule Studio | Right Execution & P-256 Sign */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT: Paycheck Rule Studio */}
        <section className="space-y-5 lg:col-span-5">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <h2 className="font-serif-display text-lg font-semibold text-ink">
              Paycheck &amp; Protection Rules
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Change any value and the plan on the right updates with live prices.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-incoming`} className="block text-xs font-medium text-ink-muted">
                  Incoming Paycheck
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-line bg-paper px-3 py-2 focus-within:border-brand-ink focus-within:bg-surface">
                  <span className="font-mono text-sm text-ink-muted">$</span>
                  <input
                    id={`${uid}-incoming`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={50}
                    value={incomingUsd}
                    onChange={(e) => setIncomingUsd(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent pl-1 font-mono text-base font-semibold text-ink tabular-nums outline-none"
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${uid}-existing`} className="block text-xs font-medium text-ink-muted">
                  Cash Already in Wallet
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-line bg-paper px-3 py-2 focus-within:border-brand-ink focus-within:bg-surface">
                  <span className="font-mono text-sm text-ink-muted">$</span>
                  <input
                    id={`${uid}-existing`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={50}
                    value={existingCashUsd}
                    onChange={(e) => setExistingCashUsd(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent pl-1 font-mono text-base font-semibold text-ink tabular-nums outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Cash Floor Slider */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor={`${uid}-floor`} className="font-medium text-ink">
                  Cash to always keep
                </label>
                <span className="font-mono font-semibold text-brand-ink tabular-nums">
                  ${cashFloorUsd.toLocaleString()} USDC
                </span>
              </div>
              <input
                id={`${uid}-floor`}
                type="range"
                min={0}
                max={3000}
                step={50}
                value={cashFloorUsd}
                aria-valuetext={`$${cashFloorUsd.toLocaleString("en-US")}`}
                onChange={(e) => setCashFloorUsd(Number(e.target.value))}
                className="allot-slider mt-2.5 w-full"
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                Rent and bills come first. No stocks are bought until your cash is above this amount.
              </p>
            </div>

            {/* Drift Guard Slider */}
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor={`${uid}-slippage`} className="font-medium text-ink">
                  Max price above market
                </label>
                <span className="font-mono font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
                  {fmtPct(maxDriftBps, false)}
                </span>
              </div>
              <input
                id={`${uid}-slippage`}
                type="range"
                min={5}
                max={100}
                step={5}
                value={maxDriftBps}
                aria-valuetext={fmtPct(maxDriftBps, false)}
                onChange={(e) => setMaxDriftBps(Number(e.target.value))}
                className="allot-slider allot-slider-amber mt-2.5 w-full"
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {(
                  [
                    [5, "Strict 0.05%"],
                    [25, "Balanced 0.25%"],
                    [60, "Flexible 0.60%"],
                  ] as const
                ).map(([bps, label]) => (
                  <button
                    key={bps}
                    type="button"
                    aria-pressed={maxDriftBps === bps}
                    onClick={() => setMaxDriftBps(bps)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      maxDriftBps === bps
                        ? "bg-amber-700 text-white shadow-xs"
                        : "border border-line bg-paper text-ink-muted hover:border-amber-700/40 hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="mt-2.5 flex cursor-pointer items-center justify-between rounded-xl border border-line bg-paper px-3 py-2.5">
                <div>
                  <div className="text-xs font-medium text-ink">
                    Use a limit order when the price is too high
                  </div>
                  <div className="text-xs text-ink-muted">
                    Waits for your price instead of overpaying, which helps on weekends
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoStageClobLimit}
                  onChange={(e) => setAutoStageClobLimit(e.target.checked)}
                  className="h-4 w-4 accent-brand-ink"
                />
              </label>
            </div>
          </div>

          {/* Equity Split Basket */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-serif-display text-lg font-semibold text-ink">
                  U.S. Stock Basket ({totalWeightPct}%)
                </h2>
                <p className="text-xs text-ink-muted">
                  {totalWeightPct < 100
                    ? `${(100 - totalWeightPct).toFixed(0)}% of surplus stays liquid in USDC`
                    : totalWeightPct === 100
                      ? "100% of surplus above cash floor invested"
                      : "Weights add up to more than 100%. Lower one."}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {totalWeightPct !== 100 && (
                  <button
                    type="button"
                    onClick={normalizeWeightsTo100}
                    className="rounded-full border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-brand-ink/40 hover:text-brand-ink"
                  >
                    Auto-Balance 100%
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full border border-brand-border bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-ink transition hover:bg-brand-soft-hover"
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" />
                  Add Stock
                </button>
              </div>
            </div>

            {pickerOpen && (
              <div className="mt-3.5 rounded-2xl border border-brand-border bg-paper p-3">
                <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                  <Search aria-hidden className="h-3.5 w-3.5 text-ink-muted" />
                  <input
                    type="search"
                    aria-label="Search stocks"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search 136 U.S. stocks (Apple, NVIDIA, SpaceX, SPY…)"
                    className="w-full text-xs text-ink outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["dual", "Limit-order ready"],
                      ["coinbase", "Coinbase"],
                      ["robinhood", "Robinhood"],
                      ["solana", "Solana"],
                      ["all", `All (${catalog?.totalUniqueStocks ?? 0})`],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={venueFilter === k}
                      onClick={() => setVenueFilter(k)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        venueFilter === k
                          ? "bg-brand text-white"
                          : "bg-surface text-ink-muted ring-1 ring-line"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 max-h-52 space-y-1 overflow-y-auto">
                  {catalogLoading ? (
                    <div className="p-2 text-xs text-ink-muted">Loading live catalog…</div>
                  ) : (
                    filteredCatalog.slice(0, 35).map((stock) => (
                      <button
                        key={stock.economicAssetId}
                        type="button"
                        onClick={() => addStockToBasket(stock)}
                        className="flex w-full items-center justify-between rounded-xl bg-surface px-3 py-2 text-left text-xs transition hover:bg-brand-soft"
                      >
                        <div className="flex items-center gap-2.5">
                          {stock.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={stock.icon}
                              alt={stock.symbol}
                              className="h-5 w-5 rounded-full border border-line object-cover"
                            />
                          ) : (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                              {stock.symbol.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <span className="font-mono font-semibold text-ink">
                              {stock.symbol}
                            </span>
                            <span className="ml-1.5 text-ink-muted">{stock.name}</span>
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                            stock.supportsClobLimit
                              ? "bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300"
                              : "bg-canvas text-ink-muted"
                          }`}
                        >
                          {stock.supportsClobLimit
                            ? "Limit orders"
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
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5"
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
                          className="h-6 w-6 shrink-0 rounded-full border border-line bg-surface object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-ink">{leg.name}</span>
                          <span className="font-mono text-xs text-ink-muted">{leg.symbol}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-line bg-surface px-2 py-1 focus-within:border-brand-ink">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={leg.weightPct}
                          aria-label={`${leg.name} weight, percent`}
                          onChange={(e) =>
                            updateLegWeight(leg.economicAssetId, Number(e.target.value))
                          }
                          className="w-10 text-right font-mono text-xs font-semibold text-ink tabular-nums outline-none"
                        />
                        <span className="ml-0.5 text-xs text-ink-muted">%</span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${leg.name}`}
                        onClick={() => removeLeg(leg.economicAssetId)}
                        disabled={legs.length <= 1}
                        className="rounded-lg p-1 text-ink-muted hover:bg-stone-200/70 dark:hover:bg-stone-800/60 hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-30"
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
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
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-serif-display text-lg font-semibold text-ink">
                  Live Payday Execution Plan
                </h2>
                <p className="text-xs text-ink-muted">
                  What happens to each stock, using live prices from True Markets.
                </p>
              </div>
              <button
                type="button"
                aria-expanded={showGatewayInspector}
                onClick={() => setShowGatewayInspector((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  showGatewayInspector
                    ? "border-brand-ink bg-brand-soft text-brand-ink"
                    : "border-line bg-paper text-ink-muted hover:text-ink"
                }`}
              >
                <Code2 aria-hidden className="h-3.5 w-3.5" />
                {showGatewayInspector ? "Hide technical details" : "Technical details"}
              </button>
            </div>

            {planError && (
              <div role="alert" className="mt-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-900 dark:text-rose-200">
                Couldn&apos;t load live prices: {planError}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {!plan && planLoading
                ? [1, 2, 3].map((n) => <div key={n} className="skeleton h-28 w-full rounded-2xl" />)
                : plan?.legs.map((leg) => {
                    const badge = consumerBadgeForLeg(leg.action, leg.limitPrice, leg.reasonCode);
                    const unitPrice = leg.quotePrice ?? leg.marketPrice;
                    const approxShares =
                      unitPrice && leg.effectiveCents > 0 ? leg.effectiveCents / 100 / unitPrice : null;
                    return (
                      <div
                        key={leg.economicAssetId}
                        className="rounded-2xl border border-line bg-paper/70 p-4 transition hover:border-brand-ink/30"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {leg.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={leg.icon}
                                alt={leg.symbol}
                                className="h-9 w-9 rounded-full border border-line bg-surface object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-mono text-xs font-bold text-white">
                                {leg.symbol.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-ink">
                                  {leg.name}
                                </span>
                                <span className="font-mono text-xs text-ink-muted">
                                  {leg.symbol}
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs text-ink tabular-nums">
                                <span className="font-mono font-semibold">
                                  {fmtUsd(leg.effectiveCents)}
                                </span>{" "}
                                {leg.effectiveCents > 0 ? "to invest" : "invested today"}
                                {approxShares !== null && (
                                  <span className="text-ink-muted">
                                    {" "}
                                    · ≈ {approxShares.toFixed(approxShares < 1 ? 4 : 2)} shares
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted tabular-nums">
                                <span>
                                  Market {leg.marketPrice ? `$${leg.marketPrice.toFixed(2)}` : "n/a"}
                                </span>
                                <span aria-hidden>·</span>
                                <span>
                                  Your price {leg.quotePrice ? `$${leg.quotePrice.toFixed(2)}` : "n/a"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            <MiniSparkline
                              id={leg.economicAssetId}
                              points={sparklines[leg.economicAssetId]}
                              breached={leg.driftBps !== null && leg.driftBps > plan.ruleSnapshot.maxDriftBps}
                            />
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.tone}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>

                        {leg.driftBps !== null && leg.reasonCode !== "CASH_FLOOR_PROTECTED" && (
                          <SpreadGauge driftBps={leg.driftBps} capBps={plan.ruleSnapshot.maxDriftBps} />
                        )}

                        <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
                          {plainLegSummary(leg, plan.ruleSnapshot.maxDriftBps)}
                        </p>

                        {showGatewayInspector && (
                          <div className="mt-3 rounded-xl border border-line bg-surface p-3 font-mono text-xs text-ink-muted">
                            <p className="mb-1.5 font-sans text-ink-muted">{leg.reasonMessage}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <span>
                                code=<strong className="text-brand-ink">{leg.reasonCode}</strong>
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
                            <div className="mt-1 truncate text-[11px] text-ink-muted">
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

          {/* Non-custodial signing: safety checks + demo toggles; the action buttons live in the sticky bar */}
          <div
            id="sign-card"
            className="scroll-mt-24 rounded-2xl border border-brand-border bg-surface p-5 shadow-xs"
          >
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink">
              <Lock aria-hidden className="h-3.5 w-3.5" />
              Only you can approve this
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Allot can&apos;t move a cent on its own. Before anything is signed, your browser
              re-checks your cash floor, your price limit and the final price, then signs with a
              key that never leaves this device.
            </p>

            <details className="group mt-3 rounded-xl border border-line bg-paper px-3 py-2 open:pb-3">
              <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                Demo: try to break the safety checks
              </summary>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-brand-ink/40">
                  <input
                    type="checkbox"
                    checked={simulateTamper}
                    onChange={(e) => {
                      setSimulateTamper(e.target.checked);
                      if (e.target.checked) setPriceMoveRefusal(null);
                    }}
                    className="accent-rose-700"
                  />
                  Server tampers with my cash floor
                </label>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    simulatePriceMove
                      ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
                      : "border-line bg-surface text-ink-muted hover:border-amber-600/40"
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
                  Price jumps right before signing
                </label>
              </div>
              {simulatePriceMove && !priceMoveRefusal && (
                <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Test armed:</strong> when you sign, the final price will come back{" "}
                    <span className="font-mono font-semibold">
                      {fmtPct(currentRule.maxDriftBps + 40)}
                    </span>{" "}
                    above market. Allot should refuse to sign and keep your USDC untouched.
                  </span>
                </div>
              )}
            </details>

            {showGatewayInspector && (
              <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-line bg-paper p-3 font-mono text-xs sm:grid-cols-2">
                <div>
                  <span className="text-ink-muted">P-256 key: </span>
                  <span className="text-ink">{vault?.fingerprint ?? "…"}</span>
                </div>
                <div className="truncate">
                  <span className="text-ink-muted">plan_hash: </span>
                  <span className="text-ink">{plan?.planHash.slice(0, 22) ?? "…"}…</span>
                </div>
              </div>
            )}

            <div aria-live="polite">
              {localVerification && !localVerification.ok && (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-900 dark:text-rose-200">
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <span className="font-semibold">
                      Blocked: the plan doesn&apos;t match your rules.{" "}
                    </span>
                    {localVerification.reason}
                    <span className="ml-1 font-mono text-rose-800 dark:text-rose-300">({localVerification.code})</span>
                  </div>
                </div>
              )}

              {priceMoveRefusal && (
                <PriceMoveRefusalPanel
                  refusal={priceMoveRefusal}
                  onClear={() => {
                    setSimulatePriceMove(false);
                    setPriceMoveRefusal(null);
                  }}
                />
              )}

              {execMessage && (
                <div
                  role={execMessage.type === "err" ? "alert" : undefined}
                  className={`mt-3 rounded-xl border p-3 text-xs ${
                    execMessage.type === "err"
                      ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200"
                      : "border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200"
                  }`}
                >
                  {execMessage.text}
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-line pt-3 font-mono text-xs text-ink-muted">
              Signing key: {vault?.fingerprint ?? "Initializing…"}
            </div>
          </div>
        </section>
      </div>

      {/* Sticky action bar: the primary action stays reachable while reviewing the long plan */}
      <div className="sticky bottom-3 z-30 flex items-center justify-between gap-3 rounded-2xl border border-brand-border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur sm:px-4 sm:py-3">
        <div className="min-w-0 text-xs text-ink-muted sm:text-sm" aria-live="polite">
          {signBlocked ? (
            <a href="#sign-card" className="font-medium text-rose-800 dark:text-rose-300 underline underline-offset-2">
              Signing was blocked. See why
            </a>
          ) : floorLocked ? (
            <span>Below your cash floor. Nothing will be bought.</span>
          ) : plan ? (
            // Two short lines on phones, one line from sm up, so the bar never wraps under the button
            <span className="flex flex-col tabular-nums sm:block">
              <span>
                Invest <strong className="font-mono text-brand-ink">{fmtUsd(totalInvestedCents)}</strong>
              </span>
              <span aria-hidden className="hidden sm:inline"> · </span>
              <span className="sr-only">, </span>
              <span>
                keep <strong className="font-mono text-ink">{fmtUsd(plan.protectedCashCents)}</strong>{" "}
                as cash
              </span>
            </span>
          ) : (
            <span>Loading live prices…</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => {
              setExecutingLive(false);
              void handleSignAndExecute(true);
            }}
            disabled={
              executing ||
              !plan ||
              !vault ||
              (localVerification ? !localVerification.ok : false)
            }
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-brand-hover disabled:opacity-40 sm:px-5 sm:py-2.5"
          >
            {executing && !executingLive ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound aria-hidden className="h-4 w-4" />
            )}
            {executing && !executingLive ? (
              "Signing…"
            ) : simulatePriceMove ? (
              <span>
                Sign<span className="hidden sm:inline"> (price-jump test)</span>
              </span>
            ) : connectedWallet ? (
              <span>
                <span className="sm:hidden">Preview</span>
                <span className="hidden sm:inline">Sign preview receipt</span>
              </span>
            ) : (
              <span>
                Sign<span className="hidden sm:inline"> &amp; get receipt</span>
              </span>
            )}
          </button>

          {connectedWallet && (
            <button
              type="button"
              onClick={() => {
                setExecutingLive(true);
                void handleSignAndExecute(false);
              }}
              disabled={
                executing ||
                !plan ||
                plan.planStatus !== "READY_TO_SIGN" ||
                (localVerification ? !localVerification.ok : false)
              }
              className="inline-flex items-center gap-2 rounded-full bg-teal-800 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-900 disabled:opacity-40 sm:px-5 sm:py-2.5"
            >
              {executing && executingLive ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck aria-hidden className="h-4 w-4" />
              )}
              {executing && executingLive ? (
                "Placing…"
              ) : (
                <span>
                  Invest<span className="hidden sm:inline"> for real</span>
                </span>
              )}
            </button>
          )}
        </div>
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
