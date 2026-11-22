import type { CompiledLeg, CompiledPaydayPlan } from "@/lib/allot/types";

export const BAR_COLORS = [
  "bg-brand",
  "bg-ink",
  "bg-teal-700",
  "bg-amber-700",
  "bg-rose-800",
  "bg-stone-600",
];

export function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Basis points as a percent people can read: 25 -> "+0.25%" (or "0.25%" unsigned). */
export function fmtPct(bps: number, signed = true): string {
  const pct = (bps / 100).toFixed(2);
  return signed && bps >= 0 ? `+${pct}%` : `${pct}%`;
}

/** One plain-English sentence per leg; the raw engine message stays in "Technical details". */
export function plainLegSummary(leg: CompiledLeg, capBps: number): string {
  const cap = fmtPct(capBps, false);
  const drift = leg.driftBps !== null ? fmtPct(leg.driftBps) : null;
  if (leg.reasonCode === "CASH_FLOOR_PROTECTED") {
    return "Kept in USDC so your cash stays above your floor.";
  }
  switch (leg.action) {
    case "EXECUTE_DEFI_MARKET":
      return drift
        ? `Buys now. Price is ${drift} vs market, inside your ${cap} limit.`
        : "Buys now at the live market price.";
    case "STAGE_CEFI_LIMIT":
      return `Price is ${drift ?? "above"} vs market, over your ${cap} limit, so Allot places an order that only fills at $${leg.limitPrice ?? "your price"} or better.`;
    case "CARRIED_OVER":
      return "Too small to buy today. This amount rolls into your next payday.";
    case "BLOCKED_NO_REFERENCE":
      return "No reliable market price right now, so this stays in USDC.";
    case "BLOCKED_STALE_REFERENCE":
      return "The market price is out of date, so this stays in USDC until it refreshes.";
    case "BLOCKED_DRIFT_NO_CLOB":
      return `Price is ${drift ?? "too far"} vs market, over your ${cap} limit, and no limit order is available, so this stays in USDC.`;
    default:
      return "Kept in USDC for now.";
  }
}

export function MiniSparkline({
  id,
  points,
  breached,
}: {
  id: string;
  points?: number[];
  breached: boolean;
}) {
  if (!points || points.length < 2) return null;

  // Downsample gently to ~14 points so 5s weekend plateaus don't create jagged micro-steps
  const targetCount = 14;
  const sampled: number[] = [];
  if (points.length <= targetCount) {
    sampled.push(...points);
  } else {
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.round((i / (targetCount - 1)) * (points.length - 1));
      sampled.push(points[idx]);
    }
  }

  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;

  const rawMin = Math.min(...sampled);
  const rawMax = Math.max(...sampled);
  const mid = (rawMin + rawMax) / 2 || 1;
  // Minimum visual band (0.25% of price) prevents tiny $0.02 wiggles from looking like cliffs
  const minBand = mid * 0.0025;
  const effectiveSpan = Math.max(rawMax - rawMin, minBand);
  const yMin = mid - effectiveSpan / 2;
  const yMax = mid + effectiveSpan / 2;

  const w = 96;
  const h = 30;
  const padX = 4;
  const padY = 5;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const coords = sampled.map((v, i) => ({
    x: padX + (i / (sampled.length - 1)) * innerW,
    y: padY + innerH - ((v - yMin) / (yMax - yMin)) * innerH,
  }));

  // Smooth Catmull-Rom -> Cubic Bezier curve
  let linePath = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = Math.max(2, Math.min(h - 2, p1.y + (p2.y - p0.y) / 6));
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = Math.max(2, Math.min(h - 2, p2.y - (p3.y - p1.y) / 6));
    linePath += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  const lastPt = coords[coords.length - 1];
  const firstPt = coords[0];
  const areaPath = `${linePath} L${lastPt.x.toFixed(1)},${h} L${firstPt.x.toFixed(1)},${h} Z`;

  // Theme-aware colours from globals.css (lighter shades in dark mode)
  const stroke = breached ? "var(--spark-warn)" : pctChange < -0.02 ? "var(--spark-down)" : "var(--spark-up)";
  const gradId = `spark-${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1 shadow-[0_1px_2px_rgba(23,20,18,0.03)]">
      <svg aria-hidden width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: stroke }} stopOpacity="0.22" />
            <stop offset="100%" style={{ stopColor: stroke }} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Subtle opening-price baseline */}
        <line
          x1={padX}
          y1={firstPt.y}
          x2={w - padX}
          y2={firstPt.y}
          style={{ stroke: "var(--border-strong)" }}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          style={{ stroke }}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Live endpoint halo + dot */}
        <circle cx={lastPt.x} cy={lastPt.y} r="4.5" style={{ fill: stroke }} fillOpacity="0.18" />
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="2.2"
          style={{ fill: stroke, stroke: "var(--bg-surface)" }}
          strokeWidth="1"
        />
      </svg>
      <div className="flex flex-col items-end font-mono leading-tight tabular-nums">
        <span className="text-[11px] uppercase tracking-wider text-ink-muted">1h</span>
        <span
          className="text-[11px] font-semibold"
          style={{ color: stroke }}
        >
          {pctChange >= 0 ? "+" : ""}
          {pctChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

export function SpreadGauge({ driftBps, capBps }: { driftBps: number; capBps: number }) {
  const maxScale = Math.max(70, capBps * 1.6, Math.abs(driftBps) * 1.25);
  const clampedDrift = Math.max(0, Math.min(maxScale, driftBps));
  const capPct = Math.min(96, (capBps / maxScale) * 100);
  const driftPct = Math.min(97, (clampedDrift / maxScale) * 100);
  const breached = driftBps > capBps;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">Price vs market · your limit {fmtPct(capBps, false)}</span>
        <span
          className={`font-mono font-semibold tabular-nums ${
            breached ? "text-amber-800 dark:text-amber-300" : "text-teal-800 dark:text-teal-300"
          }`}
        >
          {fmtPct(driftBps)}
        </span>
      </div>
      <div aria-hidden className="relative mt-1.5 h-2 w-full rounded-full bg-track">
        <div
          className="h-full rounded-l-full bg-teal-600/20"
          style={{ width: `${capPct}%` }}
        />
        <div
          className="absolute top-[-3px] h-3.5 w-[2px] rounded-full bg-brand"
          style={{ left: `${capPct}%` }}
          title={`Your limit: ${fmtPct(capBps, false)}`}
        />
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-xs transition-all duration-300 ${
            breached ? "bg-amber-600" : "bg-teal-700"
          }`}
          style={{ left: `${Math.max(2, driftPct)}%` }}
        />
      </div>
    </div>
  );
}

export function consumerBadgeForLeg(
  action: CompiledPaydayPlan["legs"][number]["action"],
  limitPrice: string | null,
  reasonCode?: string,
): { label: string; tone: string } {
  // Cash-floor holds are reported as carried over by the engine; say why instead
  if (reasonCode === "CASH_FLOOR_PROTECTED") {
    return { label: "Held · Cash floor", tone: "border-brand-border bg-brand-soft text-brand-ink" };
  }
  switch (action) {
    case "EXECUTE_DEFI_MARKET":
      return {
        label: "Buying now",
        tone: "border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200",
      };
    case "STAGE_CEFI_LIMIT":
      return {
        label: limitPrice ? `Limit order ≤ $${limitPrice}` : "Limit order",
        tone: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200",
      };
    case "CARRIED_OVER":
      return {
        label: "Next payday",
        tone: "border-brand-border bg-brand-soft text-brand-ink",
      };
    case "BLOCKED_NO_REFERENCE":
      return {
        label: "Held · No price",
        tone: "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200",
      };
    case "BLOCKED_STALE_REFERENCE":
      return {
        label: "Held · Old price",
        tone: "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200",
      };
    case "BLOCKED_DRIFT_NO_CLOB":
      return {
        label: "Held · Price too high",
        tone: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200",
      };
    default:
      return {
        label: "Held in USDC",
        tone: "border-line bg-paper text-ink-muted",
      };
  }
}
