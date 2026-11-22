// 12-month cost comparison: legacy FX off-ramp + wire vs Allot on True Markets Gateway
export function FeeComparisonStrip({ totalInvestedCents }: { totalInvestedCents: number }) {
  const monthlyInvestUsd = Math.max(0, totalInvestedCents / 100);
  const annualInflowUsd = monthlyInvestUsd * 12;
  // Legacy global worker path: ~3.8% FX off-ramp/broker spread + $25 international wire per paycheck
  const legacyAnnualFeesUsd = annualInflowUsd > 0 ? annualInflowUsd * 0.038 + 25 * 12 : 0;
  // Verified live True Markets Gateway fee (0.20% observed on mainnet Base fills, $0 gas, T+0)
  const allotAnnualFeesUsd = annualInflowUsd * 0.002;
  const annualFeeSavingsUsd = Math.max(0, legacyAnnualFeesUsd - allotAnnualFeesUsd);

  if (annualInflowUsd <= 0) return null;
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-xs font-semibold text-ink">What a year of fees looks like</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Investing <strong className="font-mono text-ink">{usd(monthlyInvestUsd)}/mo</strong>{" "}
            through a bank wire and FX conversion (~3.8% + $25 per transfer, ~3 days) costs{" "}
            <span className="font-mono text-rose-800 dark:text-rose-300 line-through">{usd(legacyAnnualFeesUsd)}/yr</span>.
            With Allot (0.20% fee, no gas, instant):{" "}
            <strong className="font-mono text-teal-800 dark:text-teal-300">{usd(allotAnnualFeesUsd)}/yr</strong>.
          </p>
        </div>
        <div className="shrink-0 font-mono text-sm font-semibold text-brand-ink tabular-nums">
          +{usd(annualFeeSavingsUsd)}/yr stays invested
        </div>
      </div>
    </section>
  );
}
