import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compileRebalancePlan } from "@/lib/allot/rebalancer";
import { DEFAULT_PROBE_USER_ID } from "@/lib/allot/store";
import type { LiveAssetQuoteSnapshot } from "@/lib/allot/types";
import { getGatewayClient } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const RebalanceRequestSchema = z.object({
  userId: z.string().optional(),
  driftThresholdPct: z.number().min(0.5).max(50).default(3),
  maxSpreadBps: z.number().min(1).max(1000).default(25),
  minTradeUsd: z.number().min(1).max(10_000).default(5),
  autoStageClobLimit: z.boolean().default(true),
  holdings: z.array(
    z.object({
      symbol: z.string().min(1),
      name: z.string().min(1),
      qty: z.number().min(0),
      targetWeightPct: z.number().min(0).max(100),
    }),
  ).min(2),
});

export async function POST(req: NextRequest) {
  try {
    const body = RebalanceRequestSchema.parse(await req.json());
    const client = getGatewayClient();
    const { paired } = await client.getStockCatalog();
    const quoteUserId = body.userId || DEFAULT_PROBE_USER_ID;

    const resolved = body.holdings.map((h) => {
      const asset = paired.find((p) => p.symbol.toUpperCase() === h.symbol.toUpperCase());
      return {
        input: h,
        economicAssetId: asset?.economicAssetId ?? h.symbol,
        asset: asset ?? null,
      };
    });

    const snapshots = await Promise.all(
      resolved.map(async ({ input, economicAssetId, asset }): Promise<[string, LiveAssetQuoteSnapshot]> => {
        if (!asset) {
          return [
            economicAssetId,
            {
              economicAssetId,
              symbol: input.symbol,
              name: input.name,
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
              quoteError: "Asset not in catalog",
            },
          ];
        }

        const [marketSnap, quoteRes] = await Promise.all([
          client.getLatestMarketPrice(asset.symbol),
          asset.defiListing
            ? client
                .getQuote(quoteUserId, {
                  asset_id: asset.defiListing.id,
                  qty: "500.00",
                  qty_unit: "quote",
                  side: "buy",
                })
                .then((q) => ({ ok: true as const, q }))
                .catch((e: unknown) => ({
                  ok: false as const,
                  err: e instanceof Error ? e.message : "Quote error",
                }))
            : Promise.resolve({ ok: false as const, err: "No DeFi listing" }),
        ]);

        return [
          economicAssetId,
          {
            economicAssetId,
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
    const plan = compileRebalancePlan({
      holdings: resolved.map((r) => ({
        economicAssetId: r.economicAssetId,
        symbol: r.asset?.symbol ?? r.input.symbol,
        name: r.asset?.name ?? r.input.name,
        qty: r.input.qty,
        marketPrice: quotesByEconomicId.get(r.economicAssetId)?.marketPrice ?? 100,
      })),
      rule: {
        driftThresholdPct: body.driftThresholdPct,
        maxSpreadBps: body.maxSpreadBps,
        minTradeCents: Math.round(body.minTradeUsd * 100),
        autoStageClobLimit: body.autoStageClobLimit,
        targets: resolved.map((r) => ({
          economicAssetId: r.economicAssetId,
          symbol: r.asset?.symbol ?? r.input.symbol,
          name: r.asset?.name ?? r.input.name,
          weightPct: r.input.targetWeightPct,
        })),
      },
      quotesByEconomicId,
    });

    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid rebalance request", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compile rebalance plan" },
      { status: 500 },
    );
  }
}
