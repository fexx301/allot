"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  Scale,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { CompiledRebalancePlan } from "@/lib/allot/rebalancer";
import {
  loadOrCreateBrowserVault,
  stampGatewayPayload,
  type LocalP256SignerVault,
} from "@/lib/allot/signer";

interface HoldingRow {
  symbol: string;
  name: string;
  qty: number;
  targetWeightPct: number;
}

const PRESETS: Array<{
  id: string;
  label: string;
  subtitle: string;
  holdings: HoldingRow[];
}> = [
  {
    id: "nvda-rally",
    label: "NVIDIA rallied 40%",
    subtitle: "NVIDIA grew to ~45% of your portfolio vs a 30% target. Allot sells some first, then uses the cash to top up what fell behind.",
    holdings: [
      { symbol: "NVDAC", name: "NVIDIA", qty: 35, targetWeightPct: 30 },
      { symbol: "AAPLC", name: "Apple", qty: 10.5, targetWeightPct: 35 },
      { symbol: "SPCXC", name: "SpaceX", qty: 11, targetWeightPct: 20 },
      { symbol: "TSLAC", name: "Tesla", qty: 4.5, targetWeightPct: 15 },
    ],
  },
  {
    id: "balanced",
    label: "Already balanced",
    subtitle: "Every holding is within 3% of target, so Allot makes no trades and you pay no fees.",
    holdings: [
      { symbol: "AAPLC", name: "Apple", qty: 10.1, targetWeightPct: 35 },
      { symbol: "NVDAC", name: "NVIDIA", qty: 23.1, targetWeightPct: 30 },
      { symbol: "SPCXC", name: "SpaceX", qty: 15.4, targetWeightPct: 20 },
      { symbol: "TSLAC", name: "Tesla", qty: 4.2, targetWeightPct: 15 },
    ],
  },
];

const ACTION_LABELS: Record<string, string> = {
  SELL_DEFI_MARKET: "Sell now",
  BUY_DEFI_MARKET: "Buy now",
  STAGE_CEFI_LIMIT_SELL: "Limit sell",
  STAGE_CEFI_LIMIT_BUY: "Limit buy",
  SKIP_WITHIN_BAND: "On target · skip",
  SKIP_BELOW_MIN: "Too small · skip",
  BLOCKED_NO_REFERENCE: "Held · No price",
  BLOCKED_STALE_REFERENCE: "Held · Old price",
  BLOCKED_DRIFT_NO_CLOB: "Held · Price too high",
};

/** Plain-English line per rebalance leg; the engine's raw reasonMessage moves to "Technical details". */
function plainRebalanceSummary(leg: CompiledRebalancePlan["legs"][number], bandPct: number): string {
  const amount = fmtUsd(Math.abs(leg.deltaCents));
  const verb = leg.side === "sell" ? "Sell" : "Buy";
  switch (leg.action) {
    case "SELL_DEFI_MARKET":
    case "BUY_DEFI_MARKET":
      return `${verb} ${amount} now at the market price to get back to ${leg.targetWeightPct.toFixed(0)}%.`;
    case "STAGE_CEFI_LIMIT_SELL":
    case "STAGE_CEFI_LIMIT_BUY":
      return `${verb} ${amount}, but the price is over your limit, so Allot places a limit order at $${leg.limitPrice ?? "your price"} instead.`;
    case "SKIP_WITHIN_BAND":
      return `Only ${Math.abs(leg.weightDriftPct).toFixed(1)}% off target, inside your ±${bandPct}% range, so no trade.`;
    case "SKIP_BELOW_MIN":
      return "The change is too small to be worth a trade.";
    case "BLOCKED_DRIFT_NO_CLOB":
      return "Price is over your limit and no limit order is available, so this is held.";
    default:
      return "No reliable price right now, so this is held.";
  }
}

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function RebalancePage() {
  const [presetId, setPresetId] = useState("nvda-rally");
  const [holdings, setHoldings] = useState<HoldingRow[]>(PRESETS[0].holdings);
  const [driftThresholdPct, setDriftThresholdPct] = useState(3);
  const [maxSpreadBps, setMaxSpreadBps] = useState(25);
  const [plan, setPlan] = useState<CompiledRebalancePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLiveWallet, setLoadingLiveWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vault, setVault] = useState<LocalP256SignerVault | null>(null);
  const [signedStamp, setSignedStamp] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    try {
      setVault(loadOrCreateBrowserVault());
    } catch {
      // ignore
    }
  }, []);

  async function loadLiveBaseHoldings() {
    setLoadingLiveWallet(true);
    setError(null);
    setSignedStamp(null);
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("allot.connected.wallet.v1") : null;
      const userId = saved ? JSON.parse(saved).userId : undefined;
      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const res = await fetch(`/api/wallet${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load wallet");
      const stockBalances = (data.balances || []).filter(
        (b: { symbol: string; available: string }) =>
          b.symbol.toUpperCase() !== "USDC" && Number(b.available) > 0,
      );
      if (stockBalances.length < 2) {
        throw new Error("Need at least 2 non-USDC stock balances to compute portfolio drift.");
      }
      const equalWeight = Math.floor(100 / stockBalances.length);
      let rem = 100 - equalWeight * stockBalances.length;
      const rows: HoldingRow[] = stockBalances.map(
        (b: { symbol: string; name?: string; available: string }) => {
          const bonus = rem > 0 ? 1 : 0;
          if (rem > 0) rem -= 1;
          return {
            symbol: b.symbol,
            name: b.name || b.symbol,
            qty: Number(b.available),
            targetWeightPct: equalWeight + bonus,
          };
        },
      );
      setPresetId("live-base-wallet");
      setHoldings(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load live Base holdings");
    } finally {
      setLoadingLiveWallet(false);
    }
  }

  async function handleSignRebalance() {
    if (!plan || !vault) return;
    setSigning(true);
    setError(null);
    try {
      const stamp = await stampGatewayPayload(
        vault,
        JSON.stringify({
          planVersion: plan.planVersion,
          planHash: plan.planHash,
          totalSellCents: plan.totalSellCents,
          totalBuyCents: plan.totalBuyCents,
        }),
      );
      setSignedStamp(stamp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setSigning(false);
    }
  }

  function downloadSignedRebalance() {
    if (!plan || !signedStamp || !vault) return;
    const payload = {
      type: "allot.rebalance.statement.v1",
      signedAt: new Date().toISOString(),
      signerPublicKey: vault.publicKeyCompressedHex,
      scheme: "SIGNATURE_SCHEME_TK_API_P256",
      stamp: signedStamp,
      plan,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `allot-rebalance-${plan.planHash.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const compile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rebalance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          driftThresholdPct,
          maxSpreadBps,
          minTradeUsd: 5,
          autoStageClobLimit: true,
          holdings,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rebalance failed");
      setPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compile rebalance");
    } finally {
      setLoading(false);
    }
  }, [driftThresholdPct, maxSpreadBps, holdings]);

  useEffect(() => {
    const t = setTimeout(() => compile(), 280);
    return () => clearTimeout(t);
  }, [compile]);

  function selectPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(p.id);
    setHoldings(p.holdings);
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-3 py-0.5 text-xs font-medium text-brand-ink">
                <Scale aria-hidden className="h-3 w-3" />
                Rebalancer
              </span>
              <h1 className="font-serif-display mt-2.5 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Keep your portfolio on target without overpaying.
              </h1>
              <p className="mt-1.5 text-sm text-ink-muted">
                When one stock grows past its target, Allot sells a little of it first and uses that
                cash to buy what fell behind. Small moves are ignored, and if a price is too high
                Allot places a <span className="font-medium text-ink">limit order</span> instead of
                overpaying.
              </p>
            </div>
            <button
              type="button"
              onClick={() => compile()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-xs font-medium text-ink hover:border-brand-ink/40"
            >
              <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh prices
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={presetId === p.id}
                onClick={() => {
                  setSignedStamp(null);
                  selectPreset(p.id);
                }}
                className={`rounded-2xl border p-4 text-left transition ${
                  presetId === p.id
                    ? "border-brand-ink bg-paper ring-1 ring-brand-ink"
                    : "border-line bg-surface hover:border-brand-ink/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-serif-display text-base font-semibold text-ink">
                    {p.label}
                  </span>
                  {presetId === p.id && <CheckCircle2 className="h-4 w-4 text-brand-ink" />}
                </div>
                <p className="mt-1 text-xs text-ink-muted">{p.subtitle}</p>
              </button>
            ))}

            <button
              type="button"
              aria-pressed={presetId === "live-base-wallet"}
              onClick={loadLiveBaseHoldings}
              disabled={loadingLiveWallet}
              className={`rounded-2xl border p-4 text-left transition ${
                presetId === "live-base-wallet"
                  ? "border-brand-ink bg-brand-soft ring-1 ring-brand-ink"
                  : "border-brand-border bg-brand-soft/50 hover:border-brand-ink"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-serif-display text-base font-semibold text-brand-ink">
                  <Wallet className="h-4 w-4" />
                  {loadingLiveWallet ? "Loading your holdings…" : "Use my real holdings"}
                </span>
                {presetId === "live-base-wallet" && (
                  <CheckCircle2 className="h-4 w-4 text-brand-ink" />
                )}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Loads your actual Apple and NVIDIA balances from True Markets to see how far off
                target you are.
              </p>
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Controls */}
        <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-xs lg:col-span-4">
          <h2 className="font-serif-display text-lg font-semibold text-ink">
            Rebalance Rules
          </h2>

          <div>
            <div className="flex justify-between text-xs">
              <label htmlFor="rebalance-band" className="font-medium text-ink">
                Ignore moves smaller than
              </label>
              <span className="font-mono font-semibold text-brand-ink">±{driftThresholdPct}%</span>
            </div>
            <input
              id="rebalance-band"
              aria-valuetext={`plus or minus ${driftThresholdPct}%`}
              type="range"
              min={1}
              max={15}
              step={1}
              value={driftThresholdPct}
              onChange={(e) => setDriftThresholdPct(Number(e.target.value))}
              className="allot-slider mt-2.5 w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs">
              <label htmlFor="rebalance-slippage" className="font-medium text-ink">
                Max price above market
              </label>
              <span className="font-mono font-semibold text-amber-800 dark:text-amber-300">
                {(maxSpreadBps / 100).toFixed(2)}%
              </span>
            </div>
            <input
              id="rebalance-slippage"
              aria-valuetext={`${(maxSpreadBps / 100).toFixed(2)}%`}
              type="range"
              min={5}
              max={100}
              step={5}
              value={maxSpreadBps}
              onChange={(e) => setMaxSpreadBps(Number(e.target.value))}
              className="allot-slider allot-slider-amber mt-2.5 w-full"
            />
          </div>

          <div className="border-t border-line pt-4">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Shares you hold now
            </h3>
            <div className="mt-3 space-y-2">
              {holdings.map((h, idx) => (
                <div
                  key={h.symbol}
                  className="flex items-center justify-between rounded-xl border border-line bg-paper px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-semibold text-ink">{h.symbol}</span>
                    <span className="ml-1.5 text-ink-muted">target {h.targetWeightPct}%</span>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 focus-within:border-brand-ink">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={h.qty}
                      aria-label={`${h.symbol} shares held`}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value));
                        setHoldings((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, qty: val } : row)),
                        );
                      }}
                      className="w-14 text-right font-mono font-semibold text-ink outline-none"
                    />
                    <span aria-hidden className="text-[11px] text-ink-muted">sh</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compiled Rebalance Plan */}
        <section className="space-y-4 lg:col-span-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Portfolio value
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-ink tabular-nums">
                {plan ? fmtUsd(plan.totalPortfolioCents) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Sell first
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-brand-ink tabular-nums">
                {plan ? fmtUsd(plan.totalSellCents) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Then buy
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-teal-800 dark:text-teal-300 tabular-nums">
                {plan ? fmtUsd(plan.totalBuyCents) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Saved vs market
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
                {plan ? `$${plan.estimatedSavingsUsd.toFixed(2)}` : "—"}
              </div>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-900 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-serif-display text-lg font-semibold text-ink">
                <ArrowRightLeft aria-hidden className="h-4 w-4 text-brand-ink" />
                Trade plan (sells run before buys)
              </div>
              {plan && (
                <span className="rounded-full bg-brand-soft px-3 py-0.5 text-xs font-semibold text-brand-ink">
                  {plan.status === "REBALANCE_READY" ? "Ready to sign" : "Already balanced"}
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {!plan && loading
                ? [1, 2, 3].map((n) => <div key={n} className="skeleton h-24 rounded-2xl" />)
                : plan?.legs.map((leg, i) => (
                    <div
                      key={leg.economicAssetId}
                      className="rounded-2xl border border-line bg-paper/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface font-mono text-xs font-semibold text-brand-ink ring-1 ring-brand-border">
                            {i + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2 font-mono text-sm">
                              <span className="font-semibold text-ink">{leg.symbol}</span>
                              <span className="text-xs text-ink-muted">
                                {leg.currentWeightPct.toFixed(1)}% → {leg.targetWeightPct.toFixed(1)}%
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  leg.weightDriftPct > 0 ? "text-brand-ink" : "text-teal-800 dark:text-teal-300"
                                }`}
                              >
                                ({leg.weightDriftPct >= 0 ? "+" : ""}
                                {leg.weightDriftPct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="font-mono text-xs text-ink-muted tabular-nums">
                              Holding {fmtUsd(leg.currentUsdCents)} · Target{" "}
                              {fmtUsd(leg.targetUsdCents)}
                              {leg.driftBps !== null
                                ? ` · Price ${leg.driftBps >= 0 ? "+" : ""}${(leg.driftBps / 100).toFixed(2)}% vs market`
                                : ""}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            leg.action.includes("CEFI_LIMIT")
                              ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
                              : leg.action.includes("DEFI_MARKET")
                                ? "border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200"
                                : "border-line bg-surface text-ink-muted"
                          }`}
                        >
                          {ACTION_LABELS[leg.action] ?? leg.action}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-ink-muted">
                        {plainRebalanceSummary(leg, driftThresholdPct)}
                      </p>

                      <details className="mt-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted">
                          <summary className="cursor-pointer">Technical details</summary>
                          <p className="mt-1">{leg.reasonMessage}</p>
                          {leg.targetAssetId && leg.orderType && (
                          <div className="mt-1 flex flex-wrap gap-2 font-mono">
                          <span className="font-semibold text-ink">
                            {leg.side?.toUpperCase()} {leg.targetVenue?.toUpperCase()}{" "}
                            {leg.orderType.toUpperCase()}
                          </span>
                          <span>
                            qty={leg.orderQty} ({leg.qtyUnit})
                          </span>
                          {leg.limitPrice && (
                            <span className="text-amber-800 dark:text-amber-300">limit=${leg.limitPrice}</span>
                          )}
                          <span>{leg.action}</span>
                          </div>
                          )}
                        </details>
                    </div>
                  ))}
            </div>

            {plan && (
              <div className="mt-5 space-y-3 border-t border-line pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3.5 py-2.5 font-mono text-xs text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-brand-ink" />
                    plan_hash: {plan.planHash.slice(0, 24)}…
                  </span>
                  <span>No borrowing · sells run before buys</span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted">
                    <Lock aria-hidden className="h-3.5 w-3.5 text-brand-ink" />
                    Signing key: {vault?.fingerprint ?? "…"}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSignRebalance}
                      disabled={signing || !vault}
                      className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-brand-hover disabled:opacity-40"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {signing ? "Signing…" : "Sign rebalance plan"}
                    </button>
                    {signedStamp && (
                      <button
                        type="button"
                        onClick={downloadSignedRebalance}
                        className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-4 py-2 text-xs font-semibold text-brand-ink hover:bg-brand-soft-hover"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download signed plan
                      </button>
                    )}
                  </div>
                </div>

                {signedStamp && (
                  <div role="status" className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-3.5 py-2.5 text-xs text-teal-900 dark:text-teal-200">
                    ✓ Signed in your browser.{" "}
                    <span className="font-mono">
                      {signedStamp.slice(0, 20)}…{signedStamp.slice(-8)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
