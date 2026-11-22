import { NextResponse } from "next/server";
import { getGatewayClient } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = getGatewayClient();
    const { assets, paired, fetchedAt } = await client.getStockCatalog();

    // Fetch live no-auth Market Data prices for the 14 dual-venue flagship stocks in parallel
    const flagships = paired.filter((p) => p.supportsClobLimit);
    const priceEntries = await Promise.all(
      flagships.map(async (stock) => {
        const snap = await client.getLatestMarketPrice(stock.symbol);
        return [stock.economicAssetId, snap] as const;
      }),
    );
    const pricesByEconomicId = Object.fromEntries(priceEntries);

    return NextResponse.json({
      fetchedAt,
      totalListings: assets.length,
      totalUniqueStocks: paired.length,
      dualVenueFlagshipCount: flagships.length,
      stocks: paired,
      pricesByEconomicId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load True Markets catalog";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
