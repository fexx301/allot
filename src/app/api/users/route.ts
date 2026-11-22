import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { makeKeyFingerprint } from "@/lib/allot/signer";
import { DEFAULT_RULE, upsertPaylink } from "@/lib/allot/store";
import { getGatewayClient, TrueMarketsApiError } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const CreateUserSchema = z.object({
  handle: z.string().min(2).max(40),
  displayName: z.string().min(1).max(80),
  roleTitle: z.string().max(120).default("Global Contractor · Paid in USDC"),
  signerPublicKey: z.string().regex(/^0[23][0-9a-fA-F]{64}$/, "Must be compressed P-256 public key hex"),
  defaultInvoiceUsd: z.number().min(5).max(500_000).default(2500),
});

export async function POST(req: NextRequest) {
  try {
    const body = CreateUserSchema.parse(await req.json());
    const cleanHandle = body.handle.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    const externalRefId = `allot_${cleanHandle}_${body.signerPublicKey.slice(0, 10)}`;

    const client = getGatewayClient();
    const user = await client.createOrGetUser(externalRefId, body.signerPublicKey);

    const solanaAddress =
      user.wallets.find((w) => w.chain_family === "solana")?.address ?? "";
    const evmAddress =
      user.wallets.find((w) => w.chain_family === "evm")?.address ?? "";

    const paylink = upsertPaylink({
      handle: cleanHandle,
      displayName: body.displayName,
      roleTitle: body.roleTitle,
      userId: user.user_id,
      solanaAddress,
      evmAddress,
      signerFingerprint: makeKeyFingerprint(body.signerPublicKey),
      defaultInvoiceUsd: body.defaultInvoiceUsd,
      rule: DEFAULT_RULE,
      createdAt: user.created_at || new Date().toISOString(),
    });

    return NextResponse.json({ user, paylink }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid user creation request", issues: err.issues }, { status: 400 });
    }
    if (err instanceof TrueMarketsApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code, requestId: err.requestId },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create Gateway user" },
      { status: 500 },
    );
  }
}
