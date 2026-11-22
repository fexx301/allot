"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, ExternalLink, ShieldCheck } from "lucide-react";
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
    const token =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("d")
        : null;
    const qs = token
      ? `id=${encodeURIComponent(id)}&d=${encodeURIComponent(token)}`
      : `id=${encodeURIComponent(id)}`;
    fetch(`/api/receipts?${qs}`)
      .then((r) => r.json())
      .then((d) => setReceipt(d.receipt ?? null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="skeleton h-48 w-full rounded-3xl" />
        <div className="skeleton h-64 w-full rounded-3xl" />
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-[#E5E1D8] bg-white p-8">
        <h1 className="font-serif-display text-xl font-semibold text-[#171412]">
          Receipt not found
        </h1>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#701735] px-4 py-2 text-sm font-medium text-white"
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

  const isLive = receipt.mode === "LIVE_GATEWAY";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#625B54] hover:text-[#701735]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Payday Studio
        </Link>
        <button
          onClick={downloadJson}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E1D8] bg-white px-4 py-1.5 text-xs font-medium text-[#171412] transition hover:border-[#701735]/40"
        >
          <Download className="h-3.5 w-3.5" />
          Export Audit JSON
        </button>
      </div>

      {/* Private-Bank Editorial Payday Statement */}
      <article className="overflow-hidden rounded-3xl border border-[#E5E1D8] bg-white shadow-sm">
        <div className="h-2 w-full bg-[#701735]" />

        <div className="border-b border-dashed border-[#D8D1C5] bg-[#FAF8F4] p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allot-logo.svg" alt="Allot" className="mb-4 h-7 w-auto" />
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                  isLive
                    ? "bg-[#701735] text-white"
                    : "border border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isLive
                  ? "Live Gateway · Verified On-Chain Execution"
                  : "Live Quotes · Preview Statement (No Funds Moved)"}
              </span>
              <h1 className="font-serif-display mt-3 text-2xl font-semibold text-[#171412] sm:text-3xl">
                Best-Execution Payday Statement
              </h1>
              <p className="mt-1 font-mono text-xs text-[#625B54]">
                {receipt.receiptId} · {new Date(receipt.createdAt).toUTCString()}
              </p>
            </div>

            <div className="rounded-2xl border border-[#E5E1D8] bg-white px-5 py-4 text-right">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Incoming Paycheck
              </div>
              <div className="font-serif-display mt-1 text-3xl font-semibold text-[#171412] tabular-nums">
                {fmtUsd(receipt.plan.incomingCents)}
              </div>
              <div className="mt-1 font-mono text-xs font-medium text-[#701735]">
                Retained Cash Floor: {fmtUsd(receipt.plan.protectedCashCents)}
              </div>
            </div>
          </div>
        </div>

        {/* Cryptographic Verification Strip */}
        <div className="grid grid-cols-1 gap-4 border-b border-[#E5E1D8] bg-white px-7 py-4 font-mono text-[11px] sm:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase text-[#625B54]">Plan Digest (SHA-256)</div>
            <div className="mt-0.5 truncate font-semibold text-[#171412]">{receipt.planHash}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#625B54]">P-256 Signer Key</div>
            <div className="mt-0.5 truncate text-[#171412]">{receipt.signerPublicKey}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#625B54]">Turnkey Stamp Proof</div>
            <div className="mt-0.5 flex items-center gap-1 text-[#701735]">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{receipt.signerProof.stampPreview}</span>
            </div>
          </div>
        </div>

        {/* Execution Breakdown Table */}
        <div className="p-7">
          <h2 className="font-serif-display text-lg font-semibold text-[#171412]">
            Per-Leg Execution &amp; Spread Audit
          </h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E1D8] font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                  <th className="py-2.5 pr-4">Asset</th>
                  <th className="py-2.5 pr-4">Allocated</th>
                  <th className="py-2.5 pr-4">Venue / Order</th>
                  <th className="py-2.5 pr-4">Ref / Fill Spread</th>
                  <th className="py-2.5 pr-4">Verdict</th>
                  <th className="py-2.5">Settlement Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E1D8] font-mono tabular-nums">
                {receipt.plan.legs.map((leg) => {
                  const exec = receipt.executions.find((e) => e.symbol === leg.symbol);
                  const shownPrice = exec?.fillPrice ?? leg.quotePrice;
                  const shownBench = exec?.benchmarkPrice ?? leg.marketPrice;
                  const shownDrift =
                    exec?.driftBps !== undefined ? exec.driftBps : leg.driftBps;

                  return (
                    <tr key={leg.economicAssetId}>
                      <td className="py-3.5 pr-4">
                        <div className="font-sans text-sm font-semibold text-[#171412]">
                          {leg.name}
                        </div>
                        <div className="text-[11px] text-[#625B54]">{leg.symbol}</div>
                      </td>
                      <td className="py-3.5 pr-4 font-semibold text-[#171412]">
                        {fmtUsd(leg.effectiveCents)}
                      </td>
                      <td className="py-3.5 pr-4">
                        {leg.targetVenue ? (
                          <span>
                            {leg.targetVenue.toUpperCase()} {leg.orderType?.toUpperCase()}
                            {leg.limitPrice ? ` @ $${leg.limitPrice}` : ""}
                          </span>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 pr-4">
                        <div>
                          {shownBench ? `$${shownBench.toFixed(2)}` : "—"} →{" "}
                          {shownPrice ? `$${shownPrice.toFixed(2)}` : "—"}
                        </div>
                        {shownDrift !== null && shownDrift !== undefined && (
                          <div className="text-[11px] text-[#625B54]">
                            {shownDrift >= 0 ? "+" : ""}
                            {shownDrift.toFixed(1)} bps{" "}
                            <span className="text-[10px] text-[#701735]">
                              ({isLive && exec?.fillPrice !== undefined ? "actual fill" : "preview quote"})
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className="rounded-full bg-[#F9EFF2] px-2.5 py-0.5 text-[10px] font-semibold text-[#701735]">
                          {leg.reasonCode}
                        </span>
                      </td>
                      <td className="py-3.5 text-[#625B54]">
                        {exec ? (
                          <div className="space-y-1">
                            <div>
                              <span className="font-semibold text-[#171412]">{exec.status}</span>
                              {exec.executedQty ? ` · ${exec.executedQty} sh` : ""}
                              {exec.feeUsd !== undefined
                                ? ` · fee $${exec.feeUsd.toFixed(5)}`
                                : ""}
                            </div>
                            <div className="text-[10px] text-[#625B54]">
                              order: {exec.orderId.slice(0, 14)}…
                            </div>
                            {exec.txHash && (
                              <a
                                href={`https://basescan.org/tx/${exec.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-2 py-0.5 text-[10px] font-semibold text-[#701735] hover:bg-[#F3DFE6]"
                              >
                                BaseScan {exec.txHash.slice(0, 8)}…{exec.txHash.slice(-4)}
                                <ExternalLink className="h-2.5 w-2.5" />
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
