"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileCheck2 } from "lucide-react";
import type { PaydayReceipt } from "@/lib/allot/types";

export default function ReceiptsListPage() {
  const [receipts, setReceipts] = useState<PaydayReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((d) => setReceipts(d.receipts ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Best-Execution Payday Receipts</h1>
        <p className="text-sm text-stone-600">
          Every signed payday split produces a permanent audit receipt showing protected cash, live
          quote vs benchmark spread in bps, venue routing, and P-256 signature verification.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-stone-500">Loading receipts…</div>
      ) : receipts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E4DE] bg-white p-10 text-center">
          <FileCheck2 className="mx-auto h-8 w-8 text-stone-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">No receipts minted yet</h2>
          <p className="mt-1 text-sm text-stone-600">
            Run a payday split in Payday Studio and sign locally with your browser P-256 key to mint
            your first verifiable receipt.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Go to Payday Studio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {receipts.map((r) => (
            <Link
              key={r.receiptId}
              href={`/receipt/${r.receiptId}`}
              className="group rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs transition hover:border-slate-900"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                    r.mode === "LIVE_GATEWAY"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-900"
                  }`}
                >
                  {r.mode === "LIVE_GATEWAY" ? "LIVE GATEWAY" : "LIVE QUOTES · PREVIEW MODE"}
                </span>
                <span className="font-mono text-xs text-stone-500">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                  ${(r.plan.incomingCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
                  USDC Payday
                </span>
                <span className="font-mono text-xs text-emerald-700">
                  Saved ${r.plan.totals.estimatedSavingsUsd.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-stone-500">
                {r.receiptId} · plan_hash {r.planHash.slice(0, 14)}…
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
