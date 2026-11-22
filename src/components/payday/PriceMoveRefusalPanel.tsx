import { ShieldAlert } from "lucide-react";
import { fmtPct, fmtUsd } from "./legParts";

export type PriceMoveRefusal = {
  symbol: string;
  name: string;
  allocatedCents: number;
  benchmarkPrice: number;
  previewQuotePrice: number | null;
  previewDriftBps: number | null;
  preparedQuotePrice: number | null;
  preparedDriftBps: number | null;
  capBps: number;
  code: string;
  reason: string;
  simulated: boolean;
};

// Shows why signing was refused when the prepared order price moved past the user's limit
export function PriceMoveRefusalPanel({
  refusal,
  onClear,
}: {
  refusal: PriceMoveRefusal;
  onClear: () => void;
}) {
  const price = (p: number | null) => (p !== null ? `$${p.toFixed(2)}` : "—");

  return (
    <div
      role="alert"
      className="mt-3 rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/40 p-4 text-xs text-amber-950 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 shrink-0 text-amber-800 dark:text-amber-300" />
          <span className="font-semibold text-amber-900 dark:text-amber-200">
            Stopped: {refusal.name}&apos;s price jumped before signing
          </span>
          {refusal.simulated && (
            <span className="rounded-full border border-amber-300 dark:border-amber-700 bg-surface px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">
              Demo
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="font-medium text-brand-ink underline hover:opacity-80"
        >
          Clear &amp; sign normally
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-surface p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-teal-800 dark:text-teal-300">
            1. Price you saw
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-ink tabular-nums">
            {refusal.symbol} {price(refusal.previewQuotePrice)}
          </div>
          <div className="text-xs text-teal-800 dark:text-teal-300 tabular-nums">
            {refusal.previewDriftBps !== null
              ? `${fmtPct(refusal.previewDriftBps)} vs market · within your ${fmtPct(refusal.capBps, false)} limit`
              : "Within your limit"}
          </div>
        </div>

        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-surface p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-800 dark:text-rose-300">
            2. Price at order time
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-rose-900 dark:text-rose-200 tabular-nums">
            {refusal.symbol} {price(refusal.preparedQuotePrice)}
          </div>
          <div className="text-xs text-rose-800 dark:text-rose-300 tabular-nums">
            {refusal.preparedDriftBps !== null
              ? `${fmtPct(refusal.preparedDriftBps)} vs market · over your ${fmtPct(refusal.capBps, false)} limit`
              : "Over your limit"}
          </div>
        </div>

        <div className="rounded-xl border border-brand-border bg-brand-soft p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink">
            3. Your money is safe
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-brand-ink tabular-nums">
            {fmtUsd(refusal.allocatedCents)} kept in USDC
          </div>
          <div className="text-xs text-brand-ink">Nothing was signed · fresh prices loaded</div>
        </div>
      </div>

      <details className="mt-2.5">
        <summary className="cursor-pointer text-xs font-medium text-amber-900 dark:text-amber-200">
          Technical details
        </summary>
        <p className="mt-1 font-mono text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          {refusal.code}: {refusal.reason}
        </p>
      </details>
    </div>
  );
}
