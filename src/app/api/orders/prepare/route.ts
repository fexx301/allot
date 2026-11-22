import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_PROBE_USER_ID } from "@/lib/allot/store";
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
    if (body.userId === DEFAULT_PROBE_USER_ID) {
      return NextResponse.json(
        {
          error:
            "This funded showcase wallet is read-only on the public demo (its P-256 signer key is offline). Create your own non-custodial wallet to place live orders.",
          code: "READ_ONLY_DEMO_WALLET",
        },
        { status: 403 },
      );
    }
    const client = getGatewayClient();

    const prepared = await Promise.all(
      body.orders.map(async (leg) => {
        try {
          const res = await client.createOrder(body.userId, {
            asset_id: leg.asset_id,
            venue: leg.venue,
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
            const isKycGate = err.status === 403 && err.code === "kyc_required";
            return {
              symbol: leg.symbol,
              venue: leg.venue,
              type: leg.type,
              ok: false,
              error: isKycGate
                ? `CeFi CLOB limit orders require True Markets KYC verification (403 kyc_required). Your USDC for ${leg.symbol} remains held safely rather than taking an unguarded wide DeFi fill.`
                : err.message,
              code: isKycGate ? "CEFI_KYC_REQUIRED" : err.code,
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
