import { describe, expect, it } from "vitest";
import { compileRebalancePlan } from "../rebalancer";
import type { LiveAssetQuoteSnapshot } from "../types";

function makeQuotes(): Map<string, LiveAssetQuoteSnapshot> {
  return new Map([
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
        marketPrice: 130,
        marketPriceTimestamp: "2026-11-22T08:00:00Z",
        quotePrice: 130.1, // ~7.7 bps -> DeFi market sell ok
        quoteQty: 1,
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
        cefiAssetId: "spcx-cefi",
        supportsClobLimit: true,
        marketPrice: 130,
        marketPriceTimestamp: "2026-11-22T08:00:00Z",
        quotePrice: 130.78, // +60 bps -> exceeds 25 bps cap -> CeFi CLOB limit buy!
        quoteQty: 1,
        quoteFeeUsd: 1,
        quoteError: null,
      },
    ],
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
        marketPrice: 350,
        marketPriceTimestamp: "2026-11-22T08:00:00Z",
        quotePrice: 350.1,
        quoteQty: 1,
        quoteFeeUsd: 1,
        quoteError: null,
      },
    ],
  ]);
}

describe("Allot Portfolio Drift Rebalancer", () => {
  it("orders SELL overweight legs before BUY underweight legs, skips legs inside drift band, and routes drifted buys to CeFi CLOB limit", () => {
    // Total portfolio = $10,000:
    // NVDAC = $4,500 (45% vs 30% target -> +15% drift -> SELL $1,500 DeFi market)
    // AAPLC = $3,600 (36% vs 35% target -> +1% drift -> SKIP within ±3% band)
    // SPCXC = $1,900 (19% vs 35% target -> -16% drift -> BUY $1,600 -> 60bps spread -> CeFi CLOB limit!)
    const plan = compileRebalancePlan({
      holdings: [
        { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", qty: 4500 / 130, marketPrice: 130 },
        { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", qty: 3600 / 350, marketPrice: 350 },
        { economicAssetId: "econ-spcx", symbol: "SPCXC", name: "SpaceX", qty: 1900 / 130, marketPrice: 130 },
      ],
      rule: {
        driftThresholdPct: 3,
        maxSpreadBps: 25,
        minTradeCents: 500,
        autoStageClobLimit: true,
        targets: [
          { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", weightPct: 30 },
          { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 35 },
          { economicAssetId: "econ-spcx", symbol: "SPCXC", name: "SpaceX", weightPct: 35 },
        ],
      },
      quotesByEconomicId: makeQuotes(),
      nowIso: "2026-11-22T09:00:00Z",
    });

    expect(plan.status).toBe("REBALANCE_READY");
    expect(plan.legs[0].symbol).toBe("NVDAC");
    expect(plan.legs[0].action).toBe("SELL_DEFI_MARKET");
    expect(plan.legs[0].side).toBe("sell");

    const spcx = plan.legs.find((l) => l.symbol === "SPCXC")!;
    expect(spcx.action).toBe("STAGE_CEFI_LIMIT_BUY");
    expect(spcx.reasonCode).toBe("PRICE_DRIFT_GUARDED");
    expect(spcx.targetVenue).toBe("cefi");
    expect(spcx.estimatedSavingsUsd).toBeGreaterThan(0);

    const aapl = plan.legs.find((l) => l.symbol === "AAPLC")!;
    expect(aapl.action).toBe("SKIP_WITHIN_BAND");
    expect(aapl.reasonCode).toBe("WITHIN_DRIFT_BAND");
    expect(plan.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns BALANCED_NO_ACTION when all positions sit inside the drift band", () => {
    const plan = compileRebalancePlan({
      holdings: [
        { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", qty: 5000 / 130, marketPrice: 130 },
        { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", qty: 5000 / 350, marketPrice: 350 },
      ],
      rule: {
        driftThresholdPct: 3,
        maxSpreadBps: 25,
        minTradeCents: 500,
        autoStageClobLimit: true,
        targets: [
          { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", weightPct: 50 },
          { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 50 },
        ],
      },
      quotesByEconomicId: makeQuotes(),
    });

    expect(plan.status).toBe("BALANCED_NO_ACTION");
    expect(plan.totalBuyCents).toBe(0);
    expect(plan.totalSellCents).toBe(0);
  });

  it("fails closed with MISSING_REFERENCE_PRICE when a rebalance leg lacks a live reference price", () => {
    const quotes = makeQuotes();
    const nvda = quotes.get("econ-nvda")!;
    quotes.set("econ-nvda", { ...nvda, marketPrice: null });

    const plan = compileRebalancePlan({
      holdings: [
        { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", qty: 4500 / 130, marketPrice: 130 },
        { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", qty: 1500 / 350, marketPrice: 350 },
      ],
      rule: {
        driftThresholdPct: 3,
        maxSpreadBps: 25,
        minTradeCents: 500,
        autoStageClobLimit: true,
        targets: [
          { economicAssetId: "econ-nvda", symbol: "NVDAC", name: "NVIDIA", weightPct: 50 },
          { economicAssetId: "econ-aapl", symbol: "AAPLC", name: "Apple", weightPct: 50 },
        ],
      },
      quotesByEconomicId: quotes,
    });

    const nvdaLeg = plan.legs.find((l) => l.symbol === "NVDAC")!;
    expect(nvdaLeg.action).toBe("BLOCKED_NO_REFERENCE");
    expect(nvdaLeg.reasonCode).toBe("MISSING_REFERENCE_PRICE");
  });
});
