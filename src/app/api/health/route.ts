import { NextResponse } from "next/server";
import { getGatewayClient } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = getGatewayClient();
    const [auth, cat] = await Promise.all([
      client.getOrgAuth(),
      client.getStockCatalog(),
    ]);
    return NextResponse.json({
      ok: true,
      region: process.env.VERCEL_REGION || process.env.FLY_REGION || "local",
      organizationId: auth.organizationId,
      tokenExpiresAt: auth.expiresAt,
      stockListings: cat.assets.length,
      dualVenueFlagships: cat.paired.filter((p) => p.supportsClobLimit).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        region: process.env.VERCEL_REGION || process.env.FLY_REGION || "local",
        error: err instanceof Error ? err.message : "Health check failed",
      },
      { status: 500 },
    );
  }
}
