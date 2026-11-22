import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGatewayClient, TrueMarketsApiError } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const PrepareSchema = z.object({
  userId: z.string().min(1),
  orders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        venue: z.enum(["cefi", "defi"]),
        asset_id: z.string().min(1),
        qty: z.string().min(1),
        qty_unit: z.enum(["base", "quote"]),
        side: z.enum(["buy", "sell"]).default("buy"),
        type: z.enum(["market", "limit"]),
        price: z.string().optional(),
      }),
    )
    .min(1)
    .max(10),
});

export async function POST(req: NextRequest) {
  try {
    const body = PrepareSchema.parse(await req.json());
    const client = getGatewayClient();

    const prepared = await Promise.all(
      body.orders.map(async (leg) => {
        try {
          const res = await client.createOrder(body.userId, {
            asset_id: leg.asset_id,
            qty: leg.qty,
            qty_unit: leg.qty_unit,
            side: leg.side,
            type: leg.type,
            ...(leg.type === "limit" && leg.price ? { price: leg.price } : {}),
          });

          if (!res.order_id) {
            return {
              symbol: leg.symbol,
              venue: leg.venue,
              type: leg.type,
              ok: false,
              error: "No order created (wallet may lack required USDC balance)",
              issues: res.quote?.issues ?? [],
              quote: res.quote ?? null,
            };
          }

          return {
            symbol: leg.symbol,
            venue: leg.venue,
            type: leg.type,
            ok: true,
            orderId: res.order_id,
            status: res.status,
            quote: res.quote ?? null,
            payloads: res.payloads ?? [],
          };
        } catch (err) {
          if (err instanceof TrueMarketsApiError) {
            return {
              symbol: leg.symbol,
              venue: leg.venue,
              type: leg.type,
              ok: false,
              error: err.message,
              code: err.code,
              requestId: err.requestId,
            };
          }
          return {
            symbol: leg.symbol,
            venue: leg.venue,
            type: leg.type,
            ok: false,
            error: err instanceof Error ? err.message : "Order preparation failed",
          };
        }
      }),
    );

    return NextResponse.json({ prepared });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid prepare payload", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare orders" },
      { status: 500 },
    );
  }
}
