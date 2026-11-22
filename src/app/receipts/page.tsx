"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2 } from "lucide-react";
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
        <h1 className="font-serif-display text-3xl font-semibold text-[#171412]">
          Best-Execution Payday Statements
        </h1>
        <p className="mt-1 text-sm text-[#625B54]">
          Every signed payday split mints a permanent audit statement showing retained cash, actual
          fill vs benchmark spread, venue routing, and P-256 signature verification.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="skeleton h-36 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
        </div>
      ) : receipts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#D8D1C5] bg-white p-10 text-center">
          <FileCheck2 className="mx-auto h-8 w-8 text-[#701735]/60" />
          <h2 className="font-serif-display mt-3 text-lg font-semibold text-[#171412]">
            No statements minted yet
          </h2>
          <p className="mt-1 text-sm text-[#625B54]">
            Sign a payday split in Payday Studio to generate your first verifiable statement.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#701735] px-5 py-2.5 text-sm font-medium text-white"
          >
            Go to Payday Studio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {receipts.map((r) => {
            const isLive = r.mode === "LIVE_GATEWAY";
            return (
              <Link
                key={r.receiptId}
                href={`/receipt/${r.receiptId}`}
                className="group overflow-hidden rounded-2xl border border-[#E5E1D8] bg-white shadow-xs transition hover:border-[#701735]"
              >
                <div className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                        isLive
                          ? "bg-[#701735] text-white"
                          : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {isLive ? "LIVE GATEWAY · BASE" : "LIVE QUOTES · PREVIEW"}
                    </span>
                    <span className="font-mono text-xs text-[#625B54]">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="font-serif-display text-2xl font-semibold text-[#171412] tabular-nums">
                      $
                      {(r.plan.incomingCents / 100).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      Payday
                    </span>
                    <span className="font-mono text-xs text-[#701735]">
                      Floor ${(r.plan.protectedCashCents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[#625B54]">
                    <span>{r.receiptId}</span>
                    <span className="inline-flex items-center gap-1 font-sans text-xs font-medium text-[#701735] group-hover:translate-x-0.5 transition">
                      Inspect Statement <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
