import { describe, expect, it } from "vitest";
import {
  allocateCentsLargestRemainder,
  compilePaydayPlan,
  computeDriftBps,
  computePlanHash,
  quantizeBaseQty,
  quantizeTickPrice,
} from "../compiler";
import {
  createP256SignerVault,
  stampGatewayPayload,
  verifyPlanAgainstLocalRule,
  verifyPreparedOrderQuote,
} from "../signer";
import { decodeSharePayload, encodeSharePayload } from "../share-token";
import type { LiveAssetQuoteSnapshot, PaycheckRule } from "../types";

const BASE_RULE: PaycheckRule = {
  ruleId: "test-rule-1",
  label: "Test Global 401(k)",
  cashFloorCents: 100_000, // $1,000
  maxDriftBps: 25,
  minNotionalCents: 200, // $2.00
  autoStageClobLimit: true,
  legs: [
    { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 50 },
    { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", weightPct: 30 },
    { economicAssetId: "econ-spcx", symbol: "SPCXC", name: "SpaceX", weightPct: 20 },
  ],
};

function makeQuotes(): Map<string, LiveAssetQuoteSnapshot> {
  return new Map<string, LiveAssetQuoteSnapshot>([
    [
      "econ-aapl",
      {
        economicAssetId: "econ-aapl",
        symbol: "AAPLC",
        name: "Apple",
        icon: "",
        defiAssetId: "aapl-defi",
        defiChain: "base",
        cefiAssetId: "aapl-cefi",
        supportsClobLimit: true,
        marketPrice: 347.21,
        marketPriceTimestamp: "2026-11-22T08:00:00Z",
        quotePrice: 347.55, // +9.8 bps -> inside 25 bps cap
        quoteQty: 2.877,
        quoteFeeUsd: 1,
        quoteError: null,
      },
    ],
    [
      "econ-nvda",
      {
        economicAssetId: "econ-nvda",
        symbol: "NVDAC",
        name: "NVIDIA",
        icon: "",
        defiAssetId: "nvda-defi",
        defiChain: "base",
        cefiAssetId: "nvda-cefi",
        supportsClobLimit: true,
        marketPrice: 129.57,
        marketPriceTimestamp: "2026-11-22T08:00:00Z",
        quotePrice: 130.14, // +44.0 bps -> exceeds 25 bps cap -> CLOB limit fallback!
        quoteQty: 4.61,
        quoteFeeUsd: 1,
        quoteError: null,
      },
    ],
    [
      "econ-spcx",
      {
        economicAssetId: "econ-spcx",
        symbol: "SPCXC",
        name: "SpaceX",
        icon: "",
        defiAssetId: "spcx-defi",
        defiChain: "base",
        cefiAssetId: null,
        supportsClobLimit: false, // DeFi-only stock for testing BLOCKED_DRIFT_NO_CLOB
        marketPrice: 129.39,
        marketPriceTimestamp: "2026-11-22T08:00:00Z",
        quotePrice: 129.96, // +44.1 bps -> blocked safely
        quoteQty: 3.07,
        quoteFeeUsd: 1,
        quoteError: null,
      },
    ],
  ]);
}

describe("Allot Deterministic Split Compiler", () => {
  it("allocates integer cents exactly with largest-remainder method and never overflows", () => {
    const legs = [
      { economicAssetId: "a", symbol: "AAPLC", name: "Apple", weightPct: 33.33 },
      { economicAssetId: "b", symbol: "NVDAC", name: "NVIDIA", weightPct: 33.33 },
      { economicAssetId: "c", symbol: "TSLAC", name: "Tesla", weightPct: 33.34 },
    ];
    const { allocations, retainedCashCents } = allocateCentsLargestRemainder(10_001, legs);
    const sum = Array.from(allocations.values()).reduce((a, b) => a + b, 0);
    expect(sum + retainedCashCents).toBe(10_001);
    expect(sum).toBe(10_001);
    for (const v of allocations.values()) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("refuses all orders with CASH_FLOOR_PROTECTED when balance <= cashFloor", () => {
    const plan = compilePaydayPlan({
      depositEventId: "dep-floor-1",
      incomingCents: 60_000, // $600
      existingCashCents: 30_000, // $300 -> total $900 <= $1,000 floor
      rule: BASE_RULE,
      quotesByEconomicId: makeQuotes(),
      mode: "LIVE_QUOTES_PREVIEW",
      nowIso: "2026-11-22T08:05:00Z",
    });

    expect(plan.planStatus).toBe("REFUSED_CASH_FLOOR");
    expect(plan.refusalSummary).toContain("CASH_FLOOR_PROTECTED");
    expect(plan.allocatableSurplusCents).toBe(0);
    expect(plan.protectedCashCents).toBe(90_000);
    expect(plan.totals.executableMarketCents).toBe(0);
    expect(plan.totals.stagedLimitCents).toBe(0);
  });

  it("executes tight-spread DeFi legs, switches drifted dual-venue legs to CeFi CLOB limit, and blocks drifted DeFi-only legs", () => {
    const plan = compilePaydayPlan({
      depositEventId: "dep-mix-1",
      incomingCents: 200_000, // $2,000 paycheck
      existingCashCents: 100_000, // already at $1,000 floor -> full $2,000 allocatable
      rule: BASE_RULE,
      quotesByEconomicId: makeQuotes(),
      mode: "LIVE_QUOTES_PREVIEW",
      nowIso: "2026-11-22T08:05:00Z",
    });

    expect(plan.planStatus).toBe("READY_TO_SIGN");
    expect(plan.allocatableSurplusCents).toBe(200_000);

    const aapl = plan.legs.find((l) => l.symbol === "AAPLC")!;
    const nvda = plan.legs.find((l) => l.symbol === "NVDAC")!;
    const spcx = plan.legs.find((l) => l.symbol === "SPCXC")!;

    expect(aapl.action).toBe("EXECUTE_DEFI_MARKET");
    expect(aapl.targetVenue).toBe("defi");
    expect(aapl.orderType).toBe("market");
    expect(aapl.orderQty).toBe("1000.00");

    expect(nvda.action).toBe("STAGE_CEFI_LIMIT");
    expect(nvda.reasonCode).toBe("PRICE_DRIFT_GUARDED");
    expect(nvda.targetVenue).toBe("cefi");
    expect(nvda.targetAssetId).toBe("nvda-cefi");
    expect(nvda.orderType).toBe("limit");
    expect(nvda.qtyUnit).toBe("base");
    expect(nvda.limitPrice).toBe(quantizeTickPrice(129.57 * 1.0025));
    expect(nvda.estimatedSavingsUsd).toBeGreaterThan(0);

    expect(spcx.action).toBe("BLOCKED_DRIFT_NO_CLOB");
    expect(spcx.reasonCode).toBe("BLOCKED_DRIFT_NO_CLOB");
    expect(plan.protectedCashCents).toBe(100_000 + 40_000); // floor + blocked spcx USDC preserved
  });

  it("carries dust legs forward with BELOW_MIN_NOTIONAL and invests once combined carryover clears minimum", () => {
    const tinyRule: PaycheckRule = {
      ...BASE_RULE,
      cashFloorCents: 0,
      minNotionalCents: 200, // $2.00
      legs: [
        { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 95 },
        { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", weightPct: 5 },
      ],
    };

    const first = compilePaydayPlan({
      depositEventId: "dep-dust-1",
      incomingCents: 2_000, // $20 -> NVDA gets $1.00 < $2.00 min
      existingCashCents: 0,
      rule: tinyRule,
      quotesByEconomicId: makeQuotes(),
      mode: "LIVE_QUOTES_PREVIEW",
      nowIso: "2026-11-22T08:05:00Z",
    });

    const nvda1 = first.legs.find((l) => l.symbol === "NVDAC")!;
    expect(nvda1.action).toBe("CARRIED_OVER");
    expect(nvda1.reasonCode).toBe("BELOW_MIN_NOTIONAL");
    expect(nvda1.carryoverDeltaCents).toBe(100);

    const second = compilePaydayPlan({
      depositEventId: "dep-dust-2",
      incomingCents: 2_500, // $25 incoming
      existingCashCents: first.protectedCashCents, // $1.00 carried-over USDC still in wallet from Payday 1
      priorCarryoverCents: { "econ-nvda": 100 },
      rule: tinyRule,
      quotesByEconomicId: makeQuotes(),
      mode: "LIVE_QUOTES_PREVIEW",
      nowIso: "2026-11-22T08:10:00Z",
    });

    const nvda2 = second.legs.find((l) => l.symbol === "NVDAC")!;
    expect(nvda2.effectiveCents).toBe(225);
    expect(nvda2.action).toBe("STAGE_CEFI_LIMIT");
    expect(second.protectedCashCents).toBe(0);
  });

  it("computes deterministic planHash and refuses client P-256 signing when server tampers with cash floor or drift cap", async () => {
    const plan = compilePaydayPlan({
      depositEventId: "dep-sign-1",
      incomingCents: 150_000,
      existingCashCents: 100_000,
      rule: BASE_RULE,
      quotesByEconomicId: makeQuotes(),
      mode: "LIVE_GATEWAY",
      nowIso: "2026-11-22T08:05:00Z",
    });

    const { planHash, ...rest } = plan;
    expect(computePlanHash(rest)).toBe(planHash);

    // Local rule matches -> ok
    expect(verifyPlanAgainstLocalRule(plan, BASE_RULE)).toEqual({ ok: true });

    // Server lowers cash floor behind user's back -> SIGNER_REQUIRED refusal!
    const stricterLocalRule: PaycheckRule = { ...BASE_RULE, cashFloorCents: 200_000 };
    const check = verifyPlanAgainstLocalRule(plan, stricterLocalRule);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("SIGNER_REQUIRED");

    // Browser P-256 vault stamps payload in exact Turnkey SIGNATURE_SCHEME_TK_API_P256 format
    const vault = createP256SignerVault();
    expect(vault.publicKeyCompressedHex).toMatch(/^0[23][0-9a-f]{64}$/i);
    const stampHeader = await stampGatewayPayload(vault, JSON.stringify({ planHash }));
    const decoded = JSON.parse(Buffer.from(stampHeader, "base64url").toString("utf8"));
    expect(decoded.scheme).toBe("SIGNATURE_SCHEME_TK_API_P256");
    expect(decoded.publicKey).toBe(vault.publicKeyCompressedHex);
    expect(decoded.signature).toMatch(/^[0-9a-f]+$/i);
  });

  it("quantizes tick prices and lot sizes cleanly", () => {
    expect(quantizeTickPrice(347.559)).toBe("347.55");
    expect(quantizeBaseQty(500, 129.89)).toBe("3.8494");
    expect(computeDriftBps(348.5528, 347.2132)).toBeCloseTo(38.58, 1);
  });

  // --- Audit Regression Tests (Findings 1–4) ---

  it("Finding 1: holds cash fail-closed with MISSING_REFERENCE_PRICE when quote exists but market reference price is null", () => {
    const quotes = makeQuotes();
    const aapl = quotes.get("econ-aapl")!;
    quotes.set("econ-aapl", { ...aapl, marketPrice: null, marketPriceTimestamp: null });

    const singleLegRule: PaycheckRule = {
      ...BASE_RULE,
      cashFloorCents: 0,
      legs: [{ economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 100 }],
    };

    const plan = compilePaydayPlan({
      depositEventId: "dep-no-ref-1",
      incomingCents: 50_000, // $500
      existingCashCents: 0,
      rule: singleLegRule,
      quotesByEconomicId: quotes,
      mode: "LIVE_GATEWAY",
    });

    expect(plan.planStatus).toBe("NO_EXECUTABLE_LEGS");
    expect(plan.refusalSummary).toContain("MISSING_REFERENCE_PRICE");
    expect(plan.legs[0].action).toBe("BLOCKED_NO_REFERENCE");
    expect(plan.legs[0].reasonCode).toBe("MISSING_REFERENCE_PRICE");
    expect(plan.legs[0].driftBps).toBeNull();
    expect(plan.totals.executableMarketCents).toBe(0);
    expect(plan.protectedCashCents).toBe(50_000);
  });

  it("Finding 2: carryover never breaches the protected cash floor ($110 available, $100 floor, $1.50 carryover -> max $10.00 buy, $100.00 protected)", () => {
    const rule: PaycheckRule = {
      ...BASE_RULE,
      cashFloorCents: 10_000, // $100.00 floor
      legs: [{ economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 100 }],
    };

    const plan = compilePaydayPlan({
      depositEventId: "dep-carry-floor-1",
      incomingCents: 1_000, // $10 incoming
      existingCashCents: 10_000, // $100 existing -> $110 total available
      priorCarryoverCents: { "econ-aapl": 150 }, // $1.50 prior carryover
      rule,
      quotesByEconomicId: makeQuotes(),
      mode: "LIVE_GATEWAY",
    });

    expect(plan.planStatus).toBe("READY_TO_SIGN");
    expect(plan.totals.executableMarketCents).toBe(1_000); // $10.00 max, NOT $11.50!
    expect(plan.protectedCashCents).toBe(10_000); // exact $100.00 reserve preserved!
    expect(plan.legs[0].effectiveCents).toBe(1_000);
    expect(verifyPlanAgainstLocalRule(plan, rule)).toEqual({ ok: true });
  });

  it("Finding 3: verifyPreparedOrderQuote refuses signing when Gateway's prepared order quote drifts past user cap", () => {
    // Inside cap: $347.55 vs $347.21 (+9.79 bps <= 25 bps) -> ok
    const okRes = verifyPreparedOrderQuote({
      symbol: "AAPLC",
      orderType: "market",
      benchmarkPrice: 347.21,
      maxDriftBps: 25,
      preparedQuote: { qty: "347.55", qty_out: "1.0" },
    });
    expect(okRes.ok).toBe(true);

    // Drifted after approval: $350.00 vs $347.21 (+80.35 bps > 25 bps) -> refused!
    const driftedRes = verifyPreparedOrderQuote({
      symbol: "AAPLC",
      orderType: "market",
      benchmarkPrice: 347.21,
      maxDriftBps: 25,
      preparedQuote: { qty: "350.00", qty_out: "1.0" },
    });
    expect(driftedRes.ok).toBe(false);
    if (!driftedRes.ok) {
      expect(driftedRes.code).toBe("PREPARED_QUOTE_DRIFT_EXCEEDED");
      expect(driftedRes.preparedDriftBps).toBeGreaterThan(25);
    }

    // Missing benchmark -> refused fail-closed!
    const noRefRes = verifyPreparedOrderQuote({
      symbol: "AAPLC",
      orderType: "market",
      benchmarkPrice: null,
      maxDriftBps: 25,
      preparedQuote: { price: "347.55" },
    });
    expect(noRefRes.ok).toBe(false);
    if (!noRefRes.ok) {
      expect(noRefRes.code).toBe("MISSING_REFERENCE_PRICE");
    }
  });

  it("Finding 4: stateless share tokens round-trip receipts cleanly across serverless instances", () => {
    const sample = { receiptId: "rcpt_stateless_1", planHash: "abc123", mode: "LIVE_QUOTES_PREVIEW" };
    const token = encodeSharePayload(sample);
    const decoded = decodeSharePayload<typeof sample>(token);
    expect(decoded).toEqual(sample);
    expect(decodeSharePayload("corrupt-token")).toBeNull();
  });
});
