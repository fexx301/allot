import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compilePaydayPlan } from "@/lib/allot/compiler";
import { DEFAULT_PROBE_USER_ID, getCarryover } from "@/lib/allot/store";
import type { LiveAssetQuoteSnapshot, PaycheckRule } from "@/lib/allot/types";
import { getGatewayClient } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const PlanRequestSchema = z.object({
  depositEventId: z.string().min(1).optional(),
  incomingUsd: z.number().min(0).max(1_000_000),
  existingCashUsd: z.number().min(0).max(10_000_000).default(0),
  userId: z.string().min(1).optional(),
  mode: z.enum(["LIVE_QUOTES_PREVIEW", "LIVE_GATEWAY"]).default("LIVE_QUOTES_PREVIEW"),
  rule: z.object({
    ruleId: z.string().min(1),
    label: z.string().min(1),
    cashFloorCents: z.number().int().min(0),
    maxDriftBps: z.number().min(0).max(2000),
    minNotionalCents: z.number().int().min(100).default(200),
    autoStageClobLimit: z.boolean().default(true),
    legs: z
      .array(
        z.object({
          economicAssetId: z.string().min(1),
          symbol: z.string().min(1),
          name: z.string().min(1),
          weightPct: z.number().min(0).max(100),
        }),
      )
      .min(1)
      .max(10),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = PlanRequestSchema.parse(await req.json());
    const client = getGatewayClient();
    const { paired } = await client.getStockCatalog();
    const quoteUserId = body.userId || DEFAULT_PROBE_USER_ID;

    const incomingCents = Math.round(body.incomingUsd * 100);
    const existingCashCents = Math.round(body.existingCashUsd * 100);

    // Match each configured leg against live True Markets catalog by economicAssetId OR symbol
    const resolvedLegs = body.rule.legs.map((leg) => {
      const match =
        paired.find((p) => p.economicAssetId === leg.economicAssetId) ||
        paired.find((p) => p.symbol.toUpperCase() === leg.symbol.toUpperCase());
      return {
        config: {
          ...leg,
          economicAssetId: match?.economicAssetId ?? leg.economicAssetId,
          symbol: match?.symbol ?? leg.symbol,
          name: match?.name ?? leg.name,
        },
        paired: match ?? null,
      };
    });

    const rule: PaycheckRule = {
      ...body.rule,
      legs: resolvedLegs.map((r) => r.config),
    };

    const surplusForSizing = Math.max(
      0,
      Math.min(incomingCents, incomingCents + existingCashCents - rule.cashFloorCents),
    );

    // Fetch live Market Data price + 1h sparkline + live Gateway POST /quotes for every leg in parallel
    const sparklinesByEconomicId: Record<string, number[]> = {};
    const snapshots = await Promise.all(
      resolvedLegs.map(async ({ config, paired: asset }): Promise<[string, LiveAssetQuoteSnapshot]> => {
        if (!asset) {
          return [
            config.economicAssetId,
            {
              economicAssetId: config.economicAssetId,
              symbol: config.symbol,
              name: config.name,
              icon: "",
              defiAssetId: null,
              defiChain: null,
              cefiAssetId: null,
              supportsClobLimit: false,
              marketPrice: null,
              marketPriceTimestamp: null,
              quotePrice: null,
              quoteQty: null,
              quoteFeeUsd: null,
              quoteError: `Asset ${config.symbol} not found in live True Markets catalog.`,
            },
          ];
        }

        const estLegUsd = Math.max(
          2,
          Number((((surplusForSizing || incomingCents || 50_000) * config.weightPct) / 10_000).toFixed(2)),
        );

        const [marketSnap, quoteRes] = await Promise.all([
          client.getLatestMarketPrice(asset.symbol),
          asset.defiListing
            ? client
                .getQuote(quoteUserId, {
                  asset_id: asset.defiListing.id,
                  qty: estLegUsd.toFixed(2),
                  qty_unit: "quote",
                  side: "buy",
                })
                .then((q) => ({ ok: true as const, q }))
                .catch((e: unknown) => ({
                  ok: false as const,
                  err: e instanceof Error ? e.message : "Quote failed",
                }))
            : Promise.resolve({ ok: false as const, err: "No DeFi listing available for quote" }),
        ]);

        if (marketSnap?.points?.length) {
          sparklinesByEconomicId[config.economicAssetId] = marketSnap.points.map((p) => p.price);
        }

        return [
          config.economicAssetId,
          {
            economicAssetId: config.economicAssetId,
            symbol: asset.symbol,
            name: asset.name,
            icon: asset.icon,
            defiAssetId: asset.defiListing?.id ?? null,
            defiChain: asset.defiListing?.chain ?? null,
            cefiAssetId: asset.cefiListing?.id ?? null,
            supportsClobLimit: asset.supportsClobLimit,
            marketPrice: marketSnap?.price ?? null,
            marketPriceTimestamp: marketSnap?.timestamp ?? null,
            quotePrice: quoteRes.ok ? Number(quoteRes.q.price) : null,
            quoteQty: quoteRes.ok ? Number(quoteRes.q.qty) : null,
            quoteFeeUsd: quoteRes.ok ? Number(quoteRes.q.fee) : null,
            quoteError: quoteRes.ok ? null : quoteRes.err,
          },
        ];
      }),
    );

    const quotesByEconomicId = new Map(snapshots);
    const priorCarryover = getCarryover(quoteUserId);

    const plan = compilePaydayPlan({
      depositEventId: body.depositEventId || `payday-${Date.now()}`,
      incomingCents,
      existingCashCents,
      priorCarryoverCents: priorCarryover,
      rule,
      quotesByEconomicId,
      mode: body.mode,
    });

    return NextResponse.json({ plan, sparklinesByEconomicId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid plan request", issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Failed to compile payday plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
