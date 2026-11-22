import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_PROBE_USER_ID } from "@/lib/allot/store";
import { getGatewayClient, TrueMarketsApiError } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const TransferSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    userId: z.string().min(1),
    asset_id: z.string().min(1),
    qty: z.string().min(1),
    to: z.string().min(10),
  }),
  z.object({
    action: z.literal("execute"),
    userId: z.string().min(1),
    transferId: z.string().min(1),
    signatures: z.array(z.string().min(1)).min(1),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const body = TransferSchema.parse(await req.json());
    if (body.userId === DEFAULT_PROBE_USER_ID) {
      return NextResponse.json(
        {
          error:
            "This funded showcase wallet is read-only on the public demo (its P-256 signer key is offline). Create your own non-custodial wallet to execute live transfers.",
          code: "READ_ONLY_DEMO_WALLET",
        },
        { status: 403 },
      );
    }
    const client = getGatewayClient();

    if (body.action === "prepare") {
      const transfer = await client.createTransfer(body.userId, {
        asset_id: body.asset_id,
        qty: body.qty,
        qty_unit: "base",
        to: body.to,
      });
      return NextResponse.json({ transfer }, { status: 201 });
    }

    const result = await client.executeTransfer(body.userId, body.transferId, body.signatures);
    return NextResponse.json({ transfer: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid transfer request", issues: err.issues }, { status: 400 });
    }
    if (err instanceof TrueMarketsApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code, requestId: err.requestId },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transfer failed" },
      { status: 500 },
    );
  }
}
