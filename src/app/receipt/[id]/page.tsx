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
      <div className="mx-auto max-w-2xl rounded-3xl border border-line bg-surface p-8">
        <h1 className="font-serif-display text-xl font-semibold text-ink">
          Receipt not found
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          This link may be mistyped, or the receipt was created on another device.
        </p>
        <Link
          href="/receipts"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          All receipts
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
          href="/receipts"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-brand-ink"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          All receipts
        </Link>
        <button
          type="button"
          onClick={downloadJson}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-1.5 text-xs font-medium text-ink transition hover:border-brand-ink/40"
        >
          <Download className="h-3.5 w-3.5" />
          Download receipt (JSON)
        </button>
      </div>

      {/* Private-Bank Editorial Payday Statement */}
      <article className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        <div className="border-b border-dashed border-line-strong bg-paper p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allot-logo.svg" alt="Allot" className="mb-4 h-7 w-auto" />
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider ${
                  isLive
                    ? "bg-brand text-white"
                    : "border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isLive
                  ? "Real trade · verified on-chain"
                  : "Preview · no money moved"}
              </span>
              <h1 className="font-serif-display mt-3 text-2xl font-semibold text-ink sm:text-3xl">
                Payday Receipt
              </h1>
              <p className="mt-1 font-mono text-xs text-ink-muted">
                {receipt.receiptId} · {new Date(receipt.createdAt).toUTCString()}
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-surface px-5 py-4 text-right">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Incoming Paycheck
              </div>
              <div className="font-serif-display mt-1 text-3xl font-semibold text-ink tabular-nums">
                {fmtUsd(receipt.plan.incomingCents)}
              </div>
              <div className="mt-1 font-mono text-xs font-medium text-brand-ink">
                Retained Cash Floor: {fmtUsd(receipt.plan.protectedCashCents)}
              </div>
            </div>
          </div>
        </div>

        {/* Cryptographic Verification Strip */}
        <div className="grid grid-cols-1 gap-4 border-b border-line bg-surface px-7 py-4 font-mono text-xs sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase text-ink-muted">Plan Digest (SHA-256)</div>
            <div className="mt-0.5 truncate font-semibold text-ink">{receipt.planHash}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-ink-muted">P-256 Signer Key</div>
            <div className="mt-0.5 truncate text-ink">{receipt.signerPublicKey}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-ink-muted">Turnkey Stamp Proof</div>
            <div className="mt-0.5 flex items-center gap-1 text-brand-ink">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{receipt.signerProof.stampPreview}</span>
            </div>
          </div>
        </div>

        {/* Execution Breakdown Table */}
        <div className="p-7">
          <h2 className="font-serif-display text-lg font-semibold text-ink">
            {isLive ? "What was bought" : "What would be bought"}
          </h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2.5 pr-4">Stock</th>
                  <th scope="col" className="py-2.5 pr-4">Amount</th>
                  <th scope="col" className="py-2.5 pr-4">Order</th>
                  <th scope="col" className="py-2.5 pr-4">Market → Paid</th>
                  <th scope="col" className="py-2.5 pr-4">Result</th>
                  <th scope="col" className="py-2.5">Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono tabular-nums">
                {receipt.plan.legs.map((leg) => {
                  const exec = receipt.executions.find((e) => e.symbol === leg.symbol);
                  const shownPrice = exec?.fillPrice ?? leg.quotePrice;
                  const shownBench = exec?.benchmarkPrice ?? leg.marketPrice;
                  const shownDrift =
                    exec?.driftBps !== undefined ? exec.driftBps : leg.driftBps;

                  return (
                    <tr key={leg.economicAssetId}>
                      <td className="py-3.5 pr-4">
                        <div className="font-sans text-sm font-semibold text-ink">
                          {leg.name}
                        </div>
                        <div className="text-xs text-ink-muted">{leg.symbol}</div>
                      </td>
                      <td className="py-3.5 pr-4 font-semibold text-ink">
                        {fmtUsd(leg.effectiveCents)}
                      </td>
                      <td className="py-3.5 pr-4">
                        {leg.targetVenue ? (
                          <span>
                            {leg.targetVenue.toUpperCase()} {leg.orderType?.toUpperCase()}
                            {leg.limitPrice ? ` @ $${leg.limitPrice}` : ""}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="py-3.5 pr-4">
                        <div>
                          {shownBench ? `$${shownBench.toFixed(2)}` : "—"} →{" "}
                          {shownPrice ? `$${shownPrice.toFixed(2)}` : "—"}
                        </div>
                        {shownDrift !== null && shownDrift !== undefined && (
                          <div className="text-xs text-ink-muted">
                            {shownDrift >= 0 ? "+" : ""}
                            {(shownDrift / 100).toFixed(2)}% vs market{" "}
                            <span className="text-[11px] text-brand-ink">
                              ({isLive && exec?.fillPrice !== undefined ? "actual fill" : "preview quote"})
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand-ink">
                          {leg.reasonCode}
                        </span>
                      </td>
                      <td className="py-3.5 text-ink-muted">
                        {exec ? (
                          <div className="space-y-1">
                            <div>
                              <span className="font-semibold text-ink">{exec.status}</span>
                              {exec.executedQty ? ` · ${exec.executedQty} sh` : ""}
                              {exec.feeUsd !== undefined
                                ? ` · fee $${exec.feeUsd.toFixed(5)}`
                                : ""}
                            </div>
                            <div className="text-[11px] text-ink-muted">
                              order: {exec.orderId.slice(0, 14)}…
                            </div>
                            {exec.txHash && (
                              <a
                                href={`https://basescan.org/tx/${exec.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-brand-border bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink hover:bg-brand-soft-hover"
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
