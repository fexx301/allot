// Live E2E smoke test against local Allot server (requires `npm run start` or `npm run dev` on port 3000)
const BASE = process.env.ALLOT_URL || "http://127.0.0.1:3000";

async function main() {
  const catRes = await fetch(`${BASE}/api/catalog`);
  const cat = await catRes.json();
  if (!catRes.ok) throw new Error(`catalog failed: ${JSON.stringify(cat)}`);
  console.log(
    `✓ GET /api/catalog -> ${cat.totalListings} listings, ${cat.totalUniqueStocks} unique stocks, ${cat.dualVenueFlagshipCount} dual-venue CLOB flagships`,
  );

  // Scenario 1: $3,500 salary with 25 bps cap
  const plan1Res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      incomingUsd: 3500,
      existingCashUsd: 400,
      mode: "LIVE_QUOTES_PREVIEW",
      rule: {
        ruleId: "smoke-1",
        label: "Smoke Salary",
        cashFloorCents: 100_000,
        maxDriftBps: 25,
        minNotionalCents: 200,
        autoStageClobLimit: true,
        legs: [
          { economicAssetId: "aapl", symbol: "AAPLC", name: "Apple", weightPct: 35 },
          { economicAssetId: "nvda", symbol: "NVDAC", name: "NVIDIA", weightPct: 30 },
          { economicAssetId: "spcx", symbol: "SPCXC", name: "SpaceX", weightPct: 20 },
          { economicAssetId: "tsla", symbol: "TSLAC", name: "Tesla", weightPct: 15 },
        ],
      },
    }),
  });
  const { plan: p1 } = await plan1Res.json();
  if (!plan1Res.ok) throw new Error(`plan1 failed`);
  console.log(
    `✓ POST /api/plan ($3,500, 25bps) -> status=${p1.planStatus} protected=$${(p1.protectedCashCents / 100).toFixed(2)} market=$${(p1.totals.executableMarketCents / 100).toFixed(2)} limit=$${(p1.totals.stagedLimitCents / 100).toFixed(2)} saved=$${p1.totals.estimatedSavingsUsd}`,
  );
  for (const leg of p1.legs) {
    console.log(
      `    ${leg.symbol.padEnd(6)} $${(leg.effectiveCents / 100).toFixed(2).padStart(7)} | drift=${leg.driftBps}bps | ${leg.action} (${leg.reasonCode})${leg.limitPrice ? ` limit=$${leg.limitPrice}` : ""}`,
    );
  }

  // Scenario 2: Cash floor refusal
  const plan2Res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      incomingUsd: 850,
      existingCashUsd: 100,
      mode: "LIVE_QUOTES_PREVIEW",
      rule: {
        ruleId: "smoke-2",
        label: "Cash Floor Test",
        cashFloorCents: 100_000,
        maxDriftBps: 25,
        minNotionalCents: 200,
        autoStageClobLimit: true,
        legs: [{ economicAssetId: "aapl", symbol: "AAPLC", name: "Apple", weightPct: 100 }],
      },
    }),
  });
  const { plan: p2 } = await plan2Res.json();
  if (p2.planStatus !== "REFUSED_CASH_FLOOR") {
    throw new Error(`Expected REFUSED_CASH_FLOOR, got ${p2.planStatus}`);
  }
  console.log(`✓ POST /api/plan ($850 vs $1,000 floor) -> ${p2.planStatus} (${p2.refusalSummary.join(",")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
