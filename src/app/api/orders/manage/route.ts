import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGatewayClient, TrueMarketsApiError } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const ManageOrderSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("modify"),
    userId: z.string().min(1),
    orderId: z.string().min(1),
    price: z.string().optional(),
    qty: z.string().optional(),
  }),
  z.object({
    action: z.literal("prepare_cancel"),
    userId: z.string().min(1),
    orderId: z.string().min(1),
  }),
  z.object({
    action: z.literal("execute_cancel"),
    userId: z.string().min(1),
    orderId: z.string().min(1),
    signatures: z.array(z.string().min(1)).min(1),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const body = ManageOrderSchema.parse(await req.json());
    const client = getGatewayClient();

    if (body.action === "modify") {
      const updated = await client.modifyOrder(body.userId, body.orderId, {
        ...(body.price ? { price: body.price } : {}),
        ...(body.qty ? { qty: body.qty } : {}),
      });
      return NextResponse.json({ order: updated });
    }

    if (body.action === "prepare_cancel") {
      const prepared = await client.prepareCancelOrder(body.userId, body.orderId);
      return NextResponse.json({ order: prepared });
    }

    const executed = await client.executeCancelOrder(body.userId, body.orderId, body.signatures);
    return NextResponse.json({ order: executed });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid manage order request", issues: err.issues }, { status: 400 });
    }
    if (err instanceof TrueMarketsApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code, requestId: err.requestId },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Order management failed" },
      { status: 500 },
    );
  }
}
