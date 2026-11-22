import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_PROBE_USER_ID, getCarryover } from "@/lib/allot/store";
import { getGatewayClient, TrueMarketsApiError } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId") || DEFAULT_PROBE_USER_ID;
    const client = getGatewayClient();

    const [balances, orders, portfolio] = await Promise.all([
      client.getBalances(userId),
      client.listOrders(userId).catch(() => []),
      client.getPortfolio(userId).catch(() => null),
    ]);

    const usdcBalances = balances.filter((b) => b.symbol.toUpperCase() === "USDC");
    const totalUsdcAvailable = usdcBalances.reduce(
      (sum, b) => sum + (Number(b.available) || 0),
      0,
    );

    return NextResponse.json({
      userId,
      fetchedAt: new Date().toISOString(),
      totalUsdcAvailable: Number(totalUsdcAvailable.toFixed(6)),
      balances,
      orders,
      portfolio,
      carryoverCents: getCarryover(userId),
    });
  } catch (err) {
    if (err instanceof TrueMarketsApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code, requestId: err.requestId },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load wallet state" },
      { status: 500 },
    );
  }
}
