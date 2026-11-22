"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2 } from "lucide-react";
import type { PaydayReceipt } from "@/lib/allot/types";

// Fixed locale + UTC so server and client render the same string (no hydration mismatch)
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ReceiptsListPage() {
  const [receipts, setReceipts] = useState<PaydayReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/receipts")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't load receipts");
        setReceipts(d.receipts ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load receipts"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif-display text-3xl font-semibold text-ink">Receipts</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every payday you sign gets a permanent receipt: what you kept as cash, what you bought,
            the price you paid, and proof that you approved it.
          </p>
        </div>
        {receipts.length > 0 && (
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium text-ink transition hover:border-brand-ink/40"
          >
            New payday
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading receipts">
          <div className="skeleton h-16 rounded-2xl" />
          <div className="skeleton h-16 rounded-2xl" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-900 dark:text-rose-200">
          {error}
        </div>
      ) : receipts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <FileCheck2 aria-hidden className="mx-auto h-8 w-8 text-brand-ink/60" />
          <h2 className="font-serif-display mt-3 text-lg font-semibold text-ink">No receipts yet</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sign a payday split in Payday Studio and your first receipt will appear here.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-hover"
          >
            Go to Payday Studio
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          <div
            aria-hidden
            className="hidden grid-cols-[7rem_1fr_1fr_1fr_8rem_1.5rem] gap-4 border-b border-line bg-paper px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:grid"
          >
            <span>Date</span>
            <span>Paycheck</span>
            <span>Invested</span>
            <span>Kept as cash</span>
            <span>Type</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {receipts.map((r) => {
              const isLive = r.mode === "LIVE_GATEWAY";
              const invested = r.plan.totals.executableMarketCents + r.plan.totals.stagedLimitCents;
              return (
                <li key={r.receiptId}>
                  <Link
                    href={`/receipt/${r.receiptId}`}
                    className="group grid grid-cols-2 items-center gap-x-4 gap-y-1 px-5 py-4 text-sm transition hover:bg-paper sm:grid-cols-[7rem_1fr_1fr_1fr_8rem_1.5rem]"
                  >
                    <span className="text-xs text-ink-muted sm:text-sm">
                      <time dateTime={r.createdAt}>{dateFmt.format(new Date(r.createdAt))}</time>
                    </span>
                    <span className="text-right font-serif-display text-lg font-semibold text-ink tabular-nums sm:text-left">
                      {usd(r.plan.incomingCents)}
                    </span>
                    <span className="font-mono text-xs text-brand-ink tabular-nums sm:text-sm">
                      <span className="text-ink-muted sm:hidden">Invested </span>
                      {usd(invested)}
                    </span>
                    <span className="text-right font-mono text-xs text-ink tabular-nums sm:text-left sm:text-sm">
                      <span className="text-ink-muted sm:hidden">Cash </span>
                      {usd(r.plan.protectedCashCents)}
                    </span>
                    <span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          isLive
                            ? "bg-brand text-white"
                            : "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-800"
                        }`}
                      >
                        <CheckCircle2 aria-hidden className="h-3 w-3" />
                        {isLive ? "Real trade" : "Preview"}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="hidden h-4 w-4 justify-self-end text-brand-ink transition group-hover:translate-x-0.5 sm:block"
                    />
                    <span className="sr-only">Open receipt {r.receiptId}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
