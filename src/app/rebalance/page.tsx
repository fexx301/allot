"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, RefreshCw, Scale, ShieldCheck } from "lucide-react";
import type { CompiledRebalancePlan } from "@/lib/allot/rebalancer";

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
    label: "Post-Earnings Drift (NVIDIA +40% Rally)",
    subtitle: "NVDAC bloated to ~45% vs 30% target · SPCXC underweight → Sell overweight first, route drifted buys via CeFi CLOB limit",
    holdings: [
      { symbol: "NVDAC", name: "NVIDIA", qty: 35, targetWeightPct: 30 },
      { symbol: "AAPLC", name: "Apple", qty: 10.5, targetWeightPct: 35 },
      { symbol: "SPCXC", name: "SpaceX", qty: 11, targetWeightPct: 20 },
      { symbol: "TSLAC", name: "Tesla", qty: 4.5, targetWeightPct: 15 },
    ],
  },
  {
    id: "balanced",
    label: "Balanced Portfolio (±3% No-Churn Band)",
    subtitle: "All holdings within ±3% of target → deterministic no-churn skip (0 unnecessary trades)",
    holdings: [
      { symbol: "AAPLC", name: "Apple", qty: 10.1, targetWeightPct: 35 },
      { symbol: "NVDAC", name: "NVIDIA", qty: 23.1, targetWeightPct: 30 },
      { symbol: "SPCXC", name: "SpaceX", qty: 15.4, targetWeightPct: 20 },
      { symbol: "TSLAC", name: "Tesla", qty: 4.2, targetWeightPct: 15 },
    ],
  },
];

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
  const [error, setError] = useState<string | null>(null);

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
      <section className="overflow-hidden rounded-3xl border border-[#E5E1D8] bg-white shadow-sm">
        <div className="h-1.5 w-full bg-[#701735]" />
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-3 py-0.5 text-xs font-medium text-[#701735]">
                <Scale className="h-3 w-3" />
                Drift Rebalancer · Live Gateway Quotes
              </span>
              <h1 className="font-serif-display mt-2.5 text-2xl font-semibold tracking-tight text-[#171412] sm:text-3xl">
                Keep your Global 401(k) on target — without weekend slippage.
              </h1>
              <p className="mt-1.5 text-sm text-[#625B54]">
                When one equity rallies past its target weight, Allot trims overweight shares first
                so USDC proceeds fund underweight buys, skips minor noise inside your drift band,
                and auto-routes any wide-spread leg to a resting{" "}
                <span className="font-medium text-[#171412]">CeFi CLOB limit order</span>.
              </p>
            </div>
            <button
              onClick={() => compile()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E1D8] bg-[#FAF8F4] px-4 py-2 text-xs font-medium text-[#171412] hover:border-[#701735]/40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Re-quote Live
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPreset(p.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  presetId === p.id
                    ? "border-[#701735] bg-[#FAF8F4] ring-1 ring-[#701735]"
                    : "border-[#E5E1D8] bg-white hover:border-[#701735]/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-serif-display text-base font-semibold text-[#171412]">
                    {p.label}
                  </span>
                  {presetId === p.id && <CheckCircle2 className="h-4 w-4 text-[#701735]" />}
                </div>
                <p className="mt-1 text-xs text-[#625B54]">{p.subtitle}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Controls */}
        <section className="space-y-4 rounded-2xl border border-[#E5E1D8] bg-white p-5 shadow-xs lg:col-span-4">
          <h2 className="font-serif-display text-lg font-semibold text-[#171412]">
            Rebalance Guardrails
          </h2>

          <div>
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[#171412]">No-Churn Drift Band</span>
              <span className="font-mono font-semibold text-[#701735]">±{driftThresholdPct}%</span>
            </div>
            <input
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
              <span className="font-medium text-[#171412]">Max Spread Guard</span>
              <span className="font-mono font-semibold text-amber-800">{maxSpreadBps} bps</span>
            </div>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={maxSpreadBps}
              onChange={(e) => setMaxSpreadBps(Number(e.target.value))}
              className="allot-slider allot-slider-amber mt-2.5 w-full"
            />
          </div>

          <div className="border-t border-[#E5E1D8] pt-4">
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#625B54]">
              Current Share Balances
            </h3>
            <div className="mt-3 space-y-2">
              {holdings.map((h, idx) => (
                <div
                  key={h.symbol}
                  className="flex items-center justify-between rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-semibold text-[#171412]">{h.symbol}</span>
                    <span className="ml-1.5 text-[#625B54]">target {h.targetWeightPct}%</span>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-[#E5E1D8] bg-white px-2 py-1 focus-within:border-[#701735]">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={h.qty}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value));
                        setHoldings((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, qty: val } : row)),
                        );
                      }}
                      className="w-14 text-right font-mono font-semibold text-[#171412] outline-none"
                    />
                    <span className="text-[10px] text-[#625B54]">sh</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compiled Rebalance Plan */}
        <section className="space-y-4 lg:col-span-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Equity Value
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-[#171412] tabular-nums">
                {plan ? fmtUsd(plan.totalPortfolioCents) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Trim (Sell First)
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-[#701735] tabular-nums">
                {plan ? fmtUsd(plan.totalSellCents) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Top Up (Buy)
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-teal-800 tabular-nums">
                {plan ? fmtUsd(plan.totalBuyCents) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Spread Saved
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-amber-800 tabular-nums">
                {plan ? `$${plan.estimatedSavingsUsd.toFixed(2)}` : "—"}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-[#E5E1D8] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-serif-display text-lg font-semibold text-[#171412]">
                <ArrowRightLeft className="h-4 w-4 text-[#701735]" />
                Deterministic Sell-First Sequence
              </div>
              {plan && (
                <span className="rounded-full bg-[#F9EFF2] px-3 py-0.5 font-mono text-[10px] font-semibold text-[#701735]">
                  {plan.status}
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {!plan && loading
                ? [1, 2, 3].map((n) => <div key={n} className="skeleton h-24 rounded-2xl" />)
                : plan?.legs.map((leg, i) => (
                    <div
                      key={leg.economicAssetId}
                      className="rounded-2xl border border-[#E5E1D8] bg-[#FAF8F4]/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white font-mono text-[11px] font-semibold text-[#701735] ring-1 ring-[#EAD2DA]">
                            {i + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2 font-mono text-sm">
                              <span className="font-semibold text-[#171412]">{leg.symbol}</span>
                              <span className="text-xs text-[#625B54]">
                                {leg.currentWeightPct.toFixed(1)}% → {leg.targetWeightPct.toFixed(1)}%
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  leg.weightDriftPct > 0 ? "text-[#701735]" : "text-teal-800"
                                }`}
                              >
                                ({leg.weightDriftPct >= 0 ? "+" : ""}
                                {leg.weightDriftPct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-[#625B54] tabular-nums">
                              Holding {fmtUsd(leg.currentUsdCents)} · Target{" "}
                              {fmtUsd(leg.targetUsdCents)}
                              {leg.driftBps !== null
                                ? ` · Live spread ${leg.driftBps.toFixed(1)} bps`
                                : ""}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold ${
                            leg.action.includes("CEFI_LIMIT")
                              ? "border-amber-200 bg-amber-50 text-amber-900"
                              : leg.action.includes("DEFI_MARKET")
                                ? "border-teal-200 bg-teal-50 text-teal-900"
                                : "border-[#E5E1D8] bg-white text-[#625B54]"
                          }`}
                        >
                          {leg.action}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-[#625B54]">{leg.reasonMessage}</p>

                      {leg.targetAssetId && leg.orderType && (
                        <div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-1.5 font-mono text-[11px] text-[#625B54]">
                          <span className="font-semibold text-[#171412]">
                            {leg.side?.toUpperCase()} {leg.targetVenue?.toUpperCase()}{" "}
                            {leg.orderType.toUpperCase()}
                          </span>
                          <span>
                            qty={leg.orderQty} ({leg.qtyUnit})
                          </span>
                          {leg.limitPrice && (
                            <span className="text-amber-800">limit=${leg.limitPrice}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
            </div>

            {plan && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-[#E5E1D8] bg-[#FAF8F4] px-3.5 py-2.5 font-mono text-[11px] text-[#625B54]">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#701735]" />
                  plan_hash: {plan.planHash.slice(0, 24)}…
                </span>
                <span>Zero margin · Sells execute before buys</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
