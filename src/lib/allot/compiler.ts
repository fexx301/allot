import { createHash } from "node:crypto";
import type {
  CompiledLeg,
  CompiledPaydayPlan,
  LiveAssetQuoteSnapshot,
  PaycheckRule,
  RefusalCode,
  SplitLegConfig,
} from "./types";

/**
 * Deterministic largest-remainder integer-cent allocator.
 * Guarantees:
 *   1. Every allocated amount is a non-negative integer number of cents.
 *   2. sum(allocations) === totalAllocatedCents (exact to the cent, never overflows).
 *   3. Ties break deterministically by symbol (lexicographic).
 */
export function allocateCentsLargestRemainder(
  surplusCents: number,
  legs: SplitLegConfig[],
): { allocations: Map<string, number>; retainedCashCents: number } {
  const allocations = new Map<string, number>();
  if (surplusCents <= 0 || legs.length === 0) {
    return { allocations, retainedCashCents: Math.max(0, surplusCents) };
  }

  const totalWeight = legs.reduce((acc, l) => acc + Math.max(0, l.weightPct), 0);
  if (totalWeight <= 0) {
    return { allocations, retainedCashCents: surplusCents };
  }
  if (totalWeight > 100.0001) {
    throw new Error(`Split weights exceed 100% (got ${totalWeight.toFixed(2)}%)`);
  }

  const targetInvestCents = Math.floor((surplusCents * totalWeight) / 100);
  const retainedCashCents = surplusCents - targetInvestCents;

  const exact = legs.map((leg) => {
    const raw = (surplusCents * Math.max(0, leg.weightPct)) / 100;
    const floor = Math.floor(raw);
    return {
      key: leg.economicAssetId,
      symbol: leg.symbol,
      floor,
      remainder: raw - floor,
    };
  });

  let remainderCents = targetInvestCents - exact.reduce((acc, e) => acc + e.floor, 0);
  const ranked = [...exact].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-12) return b.remainder - a.remainder;
    return a.symbol.localeCompare(b.symbol);
  });

  for (const item of ranked) {
    const bonus = remainderCents > 0 ? 1 : 0;
    if (remainderCents > 0) remainderCents -= 1;
    allocations.set(item.key, item.floor + bonus);
  }

  return { allocations, retainedCashCents };
}

/**
 * Quantize a CeFi CLOB limit price to True Markets exchange tick increments.
 * Follows standard price-bucket tick sizing (0.01 for >= $1 equities, 0.001 below $1).
 */
export function quantizeTickPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid price for tick quantization: ${price}`);
  }
  const tick = price >= 1 ? 0.01 : 0.001;
  const decimals = price >= 1 ? 2 : 3;
  const floored = Math.floor(price / tick) * tick;
  return floored.toFixed(decimals);
}

/**
 * Quantize base quantity for CeFi CLOB limit orders (4 decimal places for fractional equities).
 */
export function quantizeBaseQty(notionalUsd: number, limitPrice: number): string {
  if (!Number.isFinite(notionalUsd) || !Number.isFinite(limitPrice) || limitPrice <= 0) {
    return "0";
  }
  const raw = notionalUsd / limitPrice;
  const floored = Math.floor(raw * 10_000) / 10_000;
  return floored.toFixed(4);
}

export function computeDriftBps(quotePrice: number, marketPrice: number): number {
  if (!Number.isFinite(quotePrice) || !Number.isFinite(marketPrice) || marketPrice <= 0) {
    return 0;
  }
  return Number((((quotePrice - marketPrice) / marketPrice) * 10_000).toFixed(2));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function computePlanHash(planWithoutHash: Omit<CompiledPaydayPlan, "planHash">): string {
  // Hash everything deterministically bound to the user's authorization
  const digestInput = {
    planVersion: planWithoutHash.planVersion,
    depositEventId: planWithoutHash.depositEventId,
    incomingCents: planWithoutHash.incomingCents,
    existingCashCents: planWithoutHash.existingCashCents,
    cashFloorCents: planWithoutHash.cashFloorCents,
    allocatableSurplusCents: planWithoutHash.allocatableSurplusCents,
    planStatus: planWithoutHash.planStatus,
    ruleSnapshot: planWithoutHash.ruleSnapshot,
    legs: planWithoutHash.legs.map((l) => ({
      economicAssetId: l.economicAssetId,
      symbol: l.symbol,
      effectiveCents: l.effectiveCents,
      action: l.action,
      reasonCode: l.reasonCode,
      targetVenue: l.targetVenue,
      targetAssetId: l.targetAssetId,
      orderType: l.orderType,
      qtyUnit: l.qtyUnit,
      orderQty: l.orderQty,
      limitPrice: l.limitPrice,
    })),
  };
  return createHash("sha256").update(canonicalJson(digestInput)).digest("hex");
}

export interface CompilePaydayInput {
  depositEventId: string;
  incomingCents: number;
  existingCashCents: number;
  priorCarryoverCents?: Record<string, number>;
  rule: PaycheckRule;
  quotesByEconomicId: Map<string, LiveAssetQuoteSnapshot>;
  mode: "LIVE_QUOTES_PREVIEW" | "LIVE_GATEWAY";
  nowIso?: string;
}

export function compilePaydayPlan(input: CompilePaydayInput): CompiledPaydayPlan {
  const {
    depositEventId,
    incomingCents,
    existingCashCents,
    priorCarryoverCents = {},
    rule,
    quotesByEconomicId,
    mode,
    nowIso = new Date().toISOString(),
  } = input;

  const safeIncoming = Math.max(0, Math.round(incomingCents));
  const safeExisting = Math.max(0, Math.round(existingCashCents));
  const totalCashBeforeCents = safeIncoming + safeExisting;
  const cashFloorCents = Math.max(0, Math.round(rule.cashFloorCents));

  // Hard Refusal #1: CASH_FLOOR_PROTECTED
  if (totalCashBeforeCents <= cashFloorCents) {
    const emptyLegs: CompiledLeg[] = rule.legs.map((leg) => {
      const snap = quotesByEconomicId.get(leg.economicAssetId);
      return {
        economicAssetId: leg.economicAssetId,
        symbol: leg.symbol,
        name: leg.name,
        icon: snap?.icon ?? "",
        weightPct: leg.weightPct,
        allocatedCents: 0,
        effectiveCents: 0,
        action: "CARRIED_OVER",
        reasonCode: "CASH_FLOOR_PROTECTED",
        reasonMessage: `Total USDC ($${(totalCashBeforeCents / 100).toFixed(2)}) is at or below your protected cash floor ($${(cashFloorCents / 100).toFixed(2)}). Zero orders staged.`,
        targetVenue: null,
        targetAssetId: null,
        targetChain: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: snap?.marketPrice ?? null,
        quotePrice: snap?.quotePrice ?? null,
        quoteFeeUsd: snap?.quoteFeeUsd ?? null,
        driftBps:
          snap?.quotePrice && snap?.marketPrice
            ? computeDriftBps(snap.quotePrice, snap.marketPrice)
            : null,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: 0,
      };
    });

    const base: Omit<CompiledPaydayPlan, "planHash"> = {
      planVersion: "allot.plan.v1",
      depositEventId,
      compiledAt: nowIso,
      mode,
      incomingCents: safeIncoming,
      existingCashCents: safeExisting,
      totalCashBeforeCents,
      cashFloorCents,
      protectedCashCents: totalCashBeforeCents,
      allocatableSurplusCents: 0,
      cashRetainedByRuleCents: 0,
      planStatus: "REFUSED_CASH_FLOOR",
      refusalSummary: ["CASH_FLOOR_PROTECTED"],
      legs: emptyLegs,
      totals: {
        executableMarketCents: 0,
        stagedLimitCents: 0,
        carriedOverCents: 0,
        blockedCents: 0,
        estimatedSavingsUsd: 0,
      },
      ruleSnapshot: rule,
    };
    return { ...base, planHash: computePlanHash(base) };
  }

  // Only allocate true surplus above the protected cash floor (never spend more than incoming + surplus)
  const maxSpendableAboveFloorCents = Math.max(0, totalCashBeforeCents - cashFloorCents);
  const allocatableSurplusCents = Math.min(safeIncoming, maxSpendableAboveFloorCents);
  const { allocations, retainedCashCents } = allocateCentsLargestRemainder(
    allocatableSurplusCents,
    rule.legs,
  );

  // Reserve invariant: total spent across ALL legs (including released prior carryover)
  // MUST NEVER exceed maxSpendableAboveFloorCents, so protectedCashCents >= cashFloorCents ALWAYS.
  const totalBaseAllocatedCents = Array.from(allocations.values()).reduce((a, b) => a + b, 0);
  let remainingCarryHeadroomCents = Math.max(0, maxSpendableAboveFloorCents - totalBaseAllocatedCents);

  const refusals = new Set<RefusalCode>();
  let executableMarketCents = 0;
  let stagedLimitCents = 0;
  let carriedOverCents = 0;
  let blockedCents = 0;
  let totalEstimatedSavingsUsd = 0;

  const compiledLegs: CompiledLeg[] = rule.legs.map((leg) => {
    const allocatedCents = allocations.get(leg.economicAssetId) ?? 0;
    const priorCarry = Math.max(0, Math.round(priorCarryoverCents[leg.economicAssetId] ?? 0));
    const usablePriorCarry = Math.min(priorCarry, remainingCarryHeadroomCents);
    const effectiveCents = allocatedCents + usablePriorCarry;
    const snap = quotesByEconomicId.get(leg.economicAssetId);

    // Hard Refusal #2: BELOW_MIN_NOTIONAL -> carry exact cents forward
    if (effectiveCents < rule.minNotionalCents) {
      refusals.add("BELOW_MIN_NOTIONAL");
      carriedOverCents += allocatedCents;
      return {
        economicAssetId: leg.economicAssetId,
        symbol: leg.symbol,
        name: leg.name,
        icon: snap?.icon ?? "",
        weightPct: leg.weightPct,
        allocatedCents,
        effectiveCents,
        action: "CARRIED_OVER",
        reasonCode: "BELOW_MIN_NOTIONAL",
        reasonMessage: `Slice $${(effectiveCents / 100).toFixed(2)} is below minimum order notional ($${(rule.minNotionalCents / 100).toFixed(2)}). Carried over to next paycheck.`,
        targetVenue: null,
        targetAssetId: null,
        targetChain: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: snap?.marketPrice ?? null,
        quotePrice: snap?.quotePrice ?? null,
        quoteFeeUsd: snap?.quoteFeeUsd ?? null,
        driftBps:
          snap?.quotePrice && snap?.marketPrice
            ? computeDriftBps(snap.quotePrice, snap.marketPrice)
            : null,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: allocatedCents,
      };
    }

    if (!snap || !snap.quotePrice || !snap.defiAssetId) {
      refusals.add("NO_LIVE_QUOTE");
      blockedCents += allocatedCents;
      return {
        economicAssetId: leg.economicAssetId,
        symbol: leg.symbol,
        name: leg.name,
        icon: snap?.icon ?? "",
        weightPct: leg.weightPct,
        allocatedCents,
        effectiveCents,
        action: "BLOCKED_NO_QUOTE",
        reasonCode: "NO_LIVE_QUOTE",
        reasonMessage: snap?.quoteError || `No live Gateway quote available for ${leg.symbol}.`,
        targetVenue: null,
        targetAssetId: null,
        targetChain: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: snap?.marketPrice ?? null,
        quotePrice: snap?.quotePrice ?? null,
        quoteFeeUsd: snap?.quoteFeeUsd ?? null,
        driftBps: null,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: 0,
      };
    }

    // Hard Refusal #2b (Fail-Closed): MISSING_REFERENCE_PRICE -> hold cash until spread can be measured
    if (snap.marketPrice === null || !Number.isFinite(snap.marketPrice) || snap.marketPrice <= 0) {
      refusals.add("MISSING_REFERENCE_PRICE");
      blockedCents += allocatedCents;
      return {
        economicAssetId: leg.economicAssetId,
        symbol: leg.symbol,
        name: leg.name,
        icon: snap.icon,
        weightPct: leg.weightPct,
        allocatedCents,
        effectiveCents,
        action: "BLOCKED_NO_REFERENCE",
        reasonCode: "MISSING_REFERENCE_PRICE",
        reasonMessage: `No live reference price available for ${leg.symbol}. Refused unverified market fill — USDC held safely until spread can be measured.`,
        targetVenue: null,
        targetAssetId: null,
        targetChain: null,
        orderType: null,
        qtyUnit: null,
        orderQty: null,
        limitPrice: null,
        marketPrice: null,
        quotePrice: snap.quotePrice,
        quoteFeeUsd: snap.quoteFeeUsd,
        driftBps: null,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: 0,
      };
    }

    const driftBps = computeDriftBps(snap.quotePrice, snap.marketPrice);
    const legUsd = effectiveCents / 100;

    // Happy Path: Live Gateway DeFi quote is inside user's maxDriftBps guard!
    if (driftBps <= rule.maxDriftBps) {
      remainingCarryHeadroomCents = Math.max(0, remainingCarryHeadroomCents - usablePriorCarry);
      executableMarketCents += effectiveCents;
      return {
        economicAssetId: leg.economicAssetId,
        symbol: leg.symbol,
        name: leg.name,
        icon: snap.icon,
        weightPct: leg.weightPct,
        allocatedCents,
        effectiveCents,
        action: "EXECUTE_DEFI_MARKET",
        reasonCode: "APPROVED",
        reasonMessage: `Live Gateway quote (${driftBps >= 0 ? "+" : ""}${driftBps.toFixed(1)} bps vs market) is within your ${rule.maxDriftBps} bps drift cap.`,
        targetVenue: "defi",
        targetAssetId: snap.defiAssetId,
        targetChain: snap.defiChain,
        orderType: "market",
        qtyUnit: "quote",
        orderQty: legUsd.toFixed(2),
        limitPrice: null,
        marketPrice: snap.marketPrice,
        quotePrice: snap.quotePrice,
        quoteFeeUsd: snap.quoteFeeUsd,
        driftBps,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: 0,
      };
    }

    // Hard Refusal #3: PRICE_DRIFT_GUARDED!
    // Auto-route via economic_asset_id to paired CeFi CLOB limit order if supported
    if (rule.autoStageClobLimit && snap.supportsClobLimit && snap.cefiAssetId) {
      remainingCarryHeadroomCents = Math.max(0, remainingCarryHeadroomCents - usablePriorCarry);
      refusals.add("PRICE_DRIFT_GUARDED");
      const targetCapPrice = snap.marketPrice * (1 + rule.maxDriftBps / 10_000);
      const limitPriceStr = quantizeTickPrice(targetCapPrice);
      const limitPriceNum = Number(limitPriceStr);
      const baseQtyStr = quantizeBaseQty(legUsd, limitPriceNum);
      const savedBps = Math.max(0, driftBps - rule.maxDriftBps);
      const estSavingsUsd = Number(((legUsd * savedBps) / 10_000).toFixed(2));
      totalEstimatedSavingsUsd += estSavingsUsd;
      stagedLimitCents += effectiveCents;

      return {
        economicAssetId: leg.economicAssetId,
        symbol: leg.symbol,
        name: leg.name,
        icon: snap.icon,
        weightPct: leg.weightPct,
        allocatedCents,
        effectiveCents,
        action: "STAGE_CEFI_LIMIT",
        reasonCode: "PRICE_DRIFT_GUARDED",
        reasonMessage: `Refused DeFi market fill at +${driftBps.toFixed(1)} bps (cap: ${rule.maxDriftBps} bps). Auto-switched via economic_asset_id to CeFi CLOB limit @ $${limitPriceStr} (est. $${estSavingsUsd.toFixed(2)} saved).`,
        targetVenue: "cefi",
        targetAssetId: snap.cefiAssetId,
        targetChain: null,
        orderType: "limit",
        qtyUnit: "base",
        orderQty: baseQtyStr,
        limitPrice: limitPriceStr,
        marketPrice: snap.marketPrice,
        quotePrice: snap.quotePrice,
        quoteFeeUsd: snap.quoteFeeUsd,
        driftBps,
        estimatedSavingsUsd: estSavingsUsd,
        carryoverDeltaCents: 0,
      };
    }

    // Hard Refusal #3b: Drifted DeFi-only stock with no CeFi CLOB limit pair -> refuse safely
    refusals.add("BLOCKED_DRIFT_NO_CLOB");
    blockedCents += allocatedCents;
    return {
      economicAssetId: leg.economicAssetId,
      symbol: leg.symbol,
      name: leg.name,
      icon: snap.icon,
      weightPct: leg.weightPct,
      allocatedCents,
      effectiveCents,
      action: "BLOCKED_DRIFT_NO_CLOB",
      reasonCode: "BLOCKED_DRIFT_NO_CLOB",
      reasonMessage: `Refused DeFi market fill at +${driftBps.toFixed(1)} bps (cap: ${rule.maxDriftBps} bps). No CeFi CLOB limit venue exists for ${leg.symbol}; USDC preserved.`,
      targetVenue: null,
      targetAssetId: null,
      targetChain: null,
      orderType: null,
      qtyUnit: null,
      orderQty: null,
      limitPrice: null,
      marketPrice: snap.marketPrice,
      quotePrice: snap.quotePrice,
      quoteFeeUsd: snap.quoteFeeUsd,
      driftBps,
      estimatedSavingsUsd: 0,
      carryoverDeltaCents: 0,
    };
  });

  const hasExecutable = executableMarketCents > 0 || stagedLimitCents > 0;
  const protectedCashCents =
    totalCashBeforeCents - executableMarketCents - stagedLimitCents;

  const base: Omit<CompiledPaydayPlan, "planHash"> = {
    planVersion: "allot.plan.v1",
    depositEventId,
    compiledAt: nowIso,
    mode,
    incomingCents: safeIncoming,
    existingCashCents: safeExisting,
    totalCashBeforeCents,
    cashFloorCents,
    protectedCashCents,
    allocatableSurplusCents,
    cashRetainedByRuleCents: retainedCashCents,
    planStatus: hasExecutable ? "READY_TO_SIGN" : "NO_EXECUTABLE_LEGS",
    refusalSummary: Array.from(refusals),
    legs: compiledLegs,
    totals: {
      executableMarketCents,
      stagedLimitCents,
      carriedOverCents,
      blockedCents,
      estimatedSavingsUsd: Number(totalEstimatedSavingsUsd.toFixed(2)),
    },
    ruleSnapshot: rule,
  };

  return { ...base, planHash: computePlanHash(base) };
}
