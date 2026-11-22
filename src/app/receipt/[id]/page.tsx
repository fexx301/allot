"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, ShieldCheck } from "lucide-react";
import type { PaydayReceipt } from "@/lib/allot/types";

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [receipt, setReceipt] = useState<PaydayReceipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/receipts?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => setReceipt(d.receipt ?? null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-stone-500">Loading Best-Execution Receipt…</div>;
  }

  if (!receipt) {
    return (
      <div className="rounded-2xl border border-[#E5E4DE] bg-white p-8">
        <h1 className="text-lg font-semibold text-slate-900">Receipt not found</h1>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Payday Studio
        </Link>
      </div>
    );
  }

  function downloadJson() {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${receipt.receiptId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Payday Studio
        </Link>
        <button
          onClick={downloadJson}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E4DE] bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-stone-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export Audit JSON
        </button>
      </div>

      <article className="overflow-hidden rounded-2xl border border-[#E5E4DE] bg-white shadow-xs">
        <div className="border-b border-[#E5E4DE] bg-[#F7F6F2] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                  receipt.mode === "LIVE_GATEWAY"
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {receipt.mode === "LIVE_GATEWAY"
                  ? "LIVE GATEWAY · VERIFIED EXECUTION"
                  : "LIVE QUOTES · PREVIEW RECEIPT (NO FUNDS MOVED)"}
              </span>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">
                Best-Execution Payday Statement
              </h1>
              <p className="mt-0.5 font-mono text-xs text-stone-500">
                {receipt.receiptId} · {new Date(receipt.createdAt).toUTCString()}
              </p>
            </div>

            <div className="text-right font-mono">
              <div className="text-[11px] uppercase text-stone-500">Incoming Paycheck</div>
              <div className="text-2xl font-semibold text-slate-900 tabular-nums">
                {fmtUsd(receipt.plan.incomingCents)}
              </div>
              <div className="text-xs text-emerald-700">
                Protected Cash: {fmtUsd(receipt.plan.protectedCashCents)}
              </div>
            </div>
          </div>
        </div>

        {/* Cryptographic Verification Strip */}
        <div className="grid grid-cols-1 gap-3 border-b border-[#E5E4DE] bg-white px-6 py-4 font-mono text-[11px] sm:grid-cols-3">
          <div>
            <div className="text-stone-400">PLAN HASH (SHA-256)</div>
            <div className="truncate font-semibold text-slate-900">{receipt.planHash}</div>
          </div>
          <div>
            <div className="text-stone-400">P-256 SIGNER PUBLIC KEY</div>
            <div className="truncate text-slate-900">{receipt.signerPublicKey}</div>
          </div>
          <div>
            <div className="text-stone-400">TURNKEY P-256 STAMP</div>
            <div className="flex items-center gap-1 text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{receipt.signerProof.stampPreview}</span>
            </div>
          </div>
        </div>

        {/* Execution Table */}
        <div className="p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Per-Leg Routing &amp; Best-Execution Breakdown
          </h2>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E4DE] font-mono text-[11px] text-stone-500">
                  <th className="py-2 pr-4">Asset</th>
                  <th className="py-2 pr-4">Allocation</th>
                  <th className="py-2 pr-4">Venue / Order</th>
                  <th className="py-2 pr-4">Market vs Quote</th>
                  <th className="py-2 pr-4">Verdict</th>
                  <th className="py-2">Order Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E4DE] font-mono tabular-nums">
                {receipt.plan.legs.map((leg) => {
                  const exec = receipt.executions.find((e) => e.symbol === leg.symbol);
                  return (
                    <tr key={leg.economicAssetId}>
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-slate-900">{leg.symbol}</div>
                        <div className="font-sans text-[11px] text-stone-500">{leg.name}</div>
                      </td>
                      <td className="py-3 pr-4 font-semibold text-slate-900">
                        {fmtUsd(leg.effectiveCents)}
                      </td>
                      <td className="py-3 pr-4">
                        {leg.targetVenue ? (
                          <span>
                            {leg.targetVenue.toUpperCase()} {leg.orderType?.toUpperCase()}
                            {leg.limitPrice ? ` @ $${leg.limitPrice}` : ""}
                          </span>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {leg.marketPrice ? `$${leg.marketPrice.toFixed(2)}` : "—"} /{" "}
                        {leg.quotePrice ? `$${leg.quotePrice.toFixed(2)}` : "—"}
                        {leg.driftBps !== null && (
                          <span className="ml-1 text-stone-500">
                            ({leg.driftBps >= 0 ? "+" : ""}
                            {leg.driftBps.toFixed(1)} bps)
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="rounded bg-[#F7F6F2] px-1.5 py-0.5 text-[10px] font-semibold text-slate-800">
                          {leg.reasonCode}
                        </span>
                      </td>
                      <td className="py-3 text-stone-600">
                        {exec ? (
                          <div className="space-y-0.5">
                            <div>
                              <span className="font-semibold text-slate-900">{exec.status}</span>
                              {exec.executedQty ? ` · ${exec.executedQty} sh` : ""}
                              {exec.feeUsd !== undefined ? ` · fee $${exec.feeUsd.toFixed(5)}` : ""}
                            </div>
                            <div className="text-[10px] text-stone-500">
                              id: {exec.orderId.slice(0, 14)}…
                            </div>
                            {exec.txHash && (
                              <a
                                href={`https://basescan.org/tx/${exec.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block text-[10px] font-medium text-emerald-700 underline hover:text-emerald-900"
                              >
                                BaseScan: {exec.txHash.slice(0, 10)}…{exec.txHash.slice(-6)}
                              </a>
                            )}
                          </div>
                        ) : (
                          "No order placed"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  );
}
