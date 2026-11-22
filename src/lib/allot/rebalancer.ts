import { createHash } from "node:crypto";
import {
  canonicalJson,
  computeDriftBps,
  quantizeBaseQty,
  quantizeTickPrice,
} from "./compiler";
import type { LiveAssetQuoteSnapshot, SplitLegConfig } from "./types";
import type { GatewayVenue } from "../tm-gateway/types";

export interface HoldingPosition {
  economicAssetId: string;
  symbol: string;
  name: string;
  qty: number; // Current token balance
  marketPrice: number; // Current USD price per share
}

export interface RebalanceRule {
  driftThresholdPct: number; // Skip leg if |currentPct - targetPct| < driftThresholdPct
  maxSpreadBps: number; // Max allowed execution spread before switching to CeFi CLOB limit
  minTradeCents: number; // Minimum rebalance trade size (default 500 = $5.00)
  autoStageClobLimit: boolean;
  targets: SplitLegConfig[];
}

export type RebalanceLegAction =
  | "SELL_DEFI_MARKET"
  | "BUY_DEFI_MARKET"
  | "STAGE_CEFI_LIMIT_SELL"
  | "STAGE_CEFI_LIMIT_BUY"
  | "SKIP_WITHIN_BAND"
  | "SKIP_BELOW_MIN"
  | "BLOCKED_NO_REFERENCE"
  | "BLOCKED_DRIFT_NO_CLOB";

export interface CompiledRebalanceLeg {
  economicAssetId: string;
  symbol: string;
  name: string;
  icon: string;
  currentUsdCents: number;
  targetUsdCents: number;
  deltaCents: number; // positive = buy, negative = sell
  currentWeightPct: number;
  targetWeightPct: number;
  weightDriftPct: number;
  side: "buy" | "sell" | null;
  action: RebalanceLegAction;
  reasonCode:
    | "APPROVED"
    | "WITHIN_DRIFT_BAND"
    | "BELOW_MIN_NOTIONAL"
    | "MISSING_REFERENCE_PRICE"
    | "PRICE_DRIFT_GUARDED"
    | "BLOCKED_DRIFT_NO_CLOB";
  reasonMessage: string;
  targetVenue: GatewayVenue | null;
  targetAssetId: string | null;
  orderType: "market" | "limit" | null;
  qtyUnit: "base" | "quote" | null;
  orderQty: string | null;
  limitPrice: string | null;
  marketPrice: number | null;
  quotePrice: number | null;
  driftBps: number | null;
  estimatedSavingsUsd: number;
}

export interface CompiledRebalancePlan {
  planVersion: "allot.rebalance.v1";
  compiledAt: string;
  totalPortfolioCents: number;
  totalSellCents: number;
  totalBuyCents: number;
  estimatedSavingsUsd: number;
  status: "REBALANCE_READY" | "BALANCED_NO_ACTION";
  legs: CompiledRebalanceLeg[];
  planHash: string;
}

export function compileRebalancePlan(input: {
  holdings: HoldingPosition[];
  rule: RebalanceRule;
  quotesByEconomicId: Map<string, LiveAssetQuoteSnapshot>;
  nowIso?: string;
}): CompiledRebalancePlan {
  const { holdings, rule, quotesByEconomicId, nowIso = new Date().toISOString() } = input;

  const holdingByEcon = new Map<string, HoldingPosition>();
  for (const h of holdings) {
    holdingByEcon.set(h.economicAssetId, h);
  }

  // Value every targeted asset in integer cents using live Market Data price when available
  const valued = rule.targets.map((t) => {
    const h = holdingByEcon.get(t.economicAssetId);
    const snap = quotesByEconomicId.get(t.economicAssetId);
    const price = snap?.marketPrice ?? h?.marketPrice ?? 0;
    const qty = h?.qty ?? 0;
    const currentUsdCents = Math.max(0, Math.round(qty * price * 100));
    return { target: t, holding: h, snap, price, currentUsdCents };
  });

  const totalPortfolioCents = valued.reduce((sum, v) => sum + v.currentUsdCents, 0);
  const totalWeight = rule.targets.reduce((sum, t) => sum + t.weightPct, 0) || 100;

  let totalSellCents = 0;
  let totalBuyCents = 0;
  let totalSavings = 0;

  const legs: CompiledRebalanceLeg[] = valued.map(({ target, snap, price, currentUsdCents }) => {
    const normalizedTargetPct = (target.weightPct / totalWeight) * 100;
    const currentWeightPct =
      totalPortfolioCents > 0 ? (currentUsdCents / totalPortfolioCents) * 100 : 0;
    const targetUsdCents = Math.round((totalPortfolioCents * normalizedTargetPct) / 100);
    const deltaCents = targetUsdCents - currentUsdCents;
    const weightDriftPct = Number((currentWeightPct - normalizedTargetPct).toFixed(2));
    const absDrift = Math.abs(weightDriftPct);
    const absDelta = Math.abs(deltaCents);

    const driftBps =
      snap?.quotePrice && snap?.marketPrice
        ? Math.abs(computeDriftBps(snap.quotePrice, snap.marketPrice))
        : null;

    if (totalPortfolioCents === 0 || absDrift < rule.driftThresholdPct) {
      return {
        economicAssetId: target.economicAssetId,
        symbol: target.symbol,
        name: target.name,
        icon: snap?.icon ?? "",
        currentUsdCents,
        targetUsdCents,
        deltaCents,
        currentWeightPct: Number(currentWeightPct.toFixed(2)),
        targetWeightPct: Number(normalizedTargetPct.toFixed(2)),
        weightDriftPct,
        side: null,
        action: "SKIP_WITHIN_BAND",
        reasonCode: "WITHIN_DRIFT_BAND",
        reasonMessage: `Weight drift (${weightDriftPct >= 0 ? "+" : ""}${weightDriftPct.toFixed(1)}%) is inside your ±${rule.driftThresholdPct}% no-churn band.`,
        targetVenue: null,
        targetAssetId: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: snap?.marketPrice ?? (price || null),
        quotePrice: snap?.quotePrice ?? null,
        driftBps,
        estimatedSavingsUsd: 0,
      };
    }

    if (absDelta < rule.minTradeCents) {
      return {
        economicAssetId: target.economicAssetId,
        symbol: target.symbol,
        name: target.name,
        icon: snap?.icon ?? "",
        currentUsdCents,
        targetUsdCents,
        deltaCents,
        currentWeightPct: Number(currentWeightPct.toFixed(2)),
        targetWeightPct: Number(normalizedTargetPct.toFixed(2)),
        weightDriftPct,
        side: deltaCents > 0 ? "buy" : "sell",
        action: "SKIP_BELOW_MIN",
        reasonCode: "BELOW_MIN_NOTIONAL",
        reasonMessage: `Trade delta ($${(absDelta / 100).toFixed(2)}) is below minimum rebalance notional ($${(rule.minTradeCents / 100).toFixed(2)}).`,
        targetVenue: null,
        targetAssetId: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: snap?.marketPrice ?? (price || null),
        quotePrice: snap?.quotePrice ?? null,
        driftBps,
        estimatedSavingsUsd: 0,
      };
    }

    const side: "buy" | "sell" = deltaCents > 0 ? "buy" : "sell";
    const tradeUsd = absDelta / 100;

    // Fail-closed: never execute rebalance market order when reference price or live quote is missing
    if (
      !snap ||
      snap.marketPrice === null ||
      !Number.isFinite(snap.marketPrice) ||
      snap.marketPrice <= 0 ||
      snap.quotePrice === null ||
      driftBps === null
    ) {
      return {
        economicAssetId: target.economicAssetId,
        symbol: target.symbol,
        name: target.name,
        icon: snap?.icon ?? "",
        currentUsdCents,
        targetUsdCents,
        deltaCents,
        currentWeightPct: Number(currentWeightPct.toFixed(2)),
        targetWeightPct: Number(normalizedTargetPct.toFixed(2)),
        weightDriftPct,
        side,
        action: "BLOCKED_NO_REFERENCE",
        reasonCode: "MISSING_REFERENCE_PRICE",
        reasonMessage: `Missing live reference price or quote for ${target.symbol}. Rebalance leg held safely until spread can be verified.`,
        targetVenue: null,
        targetAssetId: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: snap?.marketPrice ?? null,
        quotePrice: snap?.quotePrice ?? null,
        driftBps: null,
        estimatedSavingsUsd: 0,
      };
    }

    const effectiveDrift = driftBps;

    // Inside spread cap -> DeFi market execution
    if (effectiveDrift <= rule.maxSpreadBps && snap?.defiAssetId) {
      if (side === "sell") totalSellCents += absDelta;
      else totalBuyCents += absDelta;

      const orderQty =
        side === "buy"
          ? tradeUsd.toFixed(2)
          : quantizeBaseQty(tradeUsd, snap.marketPrice || price || 1);

      return {
        economicAssetId: target.economicAssetId,
        symbol: target.symbol,
        name: target.name,
        icon: snap.icon,
        currentUsdCents,
        targetUsdCents,
        deltaCents,
        currentWeightPct: Number(currentWeightPct.toFixed(2)),
        targetWeightPct: Number(normalizedTargetPct.toFixed(2)),
        weightDriftPct,
        side,
        action: side === "sell" ? "SELL_DEFI_MARKET" : "BUY_DEFI_MARKET",
        reasonCode: "APPROVED",
        reasonMessage: `${side === "sell" ? "Trim overweight" : "Top up underweight"} leg (${weightDriftPct >= 0 ? "+" : ""}${weightDriftPct.toFixed(1)}% drift). Live spread (${effectiveDrift.toFixed(1)} bps) inside ${rule.maxSpreadBps} bps cap.`,
        targetVenue: "defi",
        targetAssetId: snap.defiAssetId,
        orderType: "market",
        qtyUnit: side === "buy" ? "quote" : "base",
        orderQty,
        limitPrice: null,
        marketPrice: snap.marketPrice,
        quotePrice: snap.quotePrice,
        driftBps,
        estimatedSavingsUsd: 0,
      };
    }

    // Spread exceeded cap -> auto-switch via economic_asset_id to CeFi CLOB limit!
    if (rule.autoStageClobLimit && snap?.supportsClobLimit && snap.cefiAssetId && snap.marketPrice) {
      if (side === "sell") totalSellCents += absDelta;
      else totalBuyCents += absDelta;

      const factor =
        side === "buy"
          ? 1 + rule.maxSpreadBps / 10_000
          : 1 - rule.maxSpreadBps / 10_000;
      const limitPrice = quantizeTickPrice(snap.marketPrice * factor);
      const orderQty = quantizeBaseQty(tradeUsd, Number(limitPrice));
      const savedBps = Math.max(0, effectiveDrift - rule.maxSpreadBps);
      const estSavings = Number(((tradeUsd * savedBps) / 10_000).toFixed(2));
      totalSavings += estSavings;

      return {
        economicAssetId: target.economicAssetId,
        symbol: target.symbol,
        name: target.name,
        icon: snap.icon,
        currentUsdCents,
        targetUsdCents,
        deltaCents,
        currentWeightPct: Number(currentWeightPct.toFixed(2)),
        targetWeightPct: Number(normalizedTargetPct.toFixed(2)),
        weightDriftPct,
        side,
        action: side === "sell" ? "STAGE_CEFI_LIMIT_SELL" : "STAGE_CEFI_LIMIT_BUY",
        reasonCode: "PRICE_DRIFT_GUARDED",
        reasonMessage: `Refused ${side} market fill at ${effectiveDrift.toFixed(1)} bps spread (cap ${rule.maxSpreadBps} bps). Staged CeFi CLOB limit ${side} @ $${limitPrice} (est. $${estSavings.toFixed(2)} saved).`,
        targetVenue: "cefi",
        targetAssetId: snap.cefiAssetId,
        orderType: "limit",
        qtyUnit: "base",
        orderQty,
        limitPrice,
        marketPrice: snap.marketPrice,
        quotePrice: snap.quotePrice,
        driftBps,
        estimatedSavingsUsd: estSavings,
      };
    }

    return {
      economicAssetId: target.economicAssetId,
      symbol: target.symbol,
      name: target.name,
      icon: snap?.icon ?? "",
      currentUsdCents,
      targetUsdCents,
      deltaCents,
      currentWeightPct: Number(currentWeightPct.toFixed(2)),
      targetWeightPct: Number(normalizedTargetPct.toFixed(2)),
      weightDriftPct,
      side,
      action: "BLOCKED_DRIFT_NO_CLOB",
      reasonCode: "BLOCKED_DRIFT_NO_CLOB",
      reasonMessage: `Spread (${effectiveDrift.toFixed(1)} bps) exceeds cap and no CeFi CLOB venue exists for ${target.symbol}.`,
      targetVenue: null,
      targetAssetId: null,
      orderType: null,
      qtyUnit: null,
      orderQty: null,
      limitPrice: null,
      marketPrice: snap?.marketPrice ?? (price || null),
      quotePrice: snap?.quotePrice ?? null,
      driftBps,
      estimatedSavingsUsd: 0,
    };
  });

  // Sort SELL legs first so proceeds fund BUY legs cleanly
  legs.sort((a, b) => {
    const rank = (l: CompiledRebalanceLeg) =>
      l.side === "sell" && l.targetAssetId ? 0 : l.side === "buy" && l.targetAssetId ? 1 : 2;
    return rank(a) - rank(b);
  });

  const hasActions = legs.some((l) => Boolean(l.targetAssetId));
  const body: Omit<CompiledRebalancePlan, "planHash"> = {
    planVersion: "allot.rebalance.v1",
    compiledAt: nowIso,
    totalPortfolioCents,
    totalSellCents,
    totalBuyCents,
    estimatedSavingsUsd: Number(totalSavings.toFixed(2)),
    status: hasActions ? "REBALANCE_READY" : "BALANCED_NO_ACTION",
    legs,
  };

  const planHash = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return { ...body, planHash };
}
