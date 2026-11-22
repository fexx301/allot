import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decodeSharePayload } from "@/lib/allot/share-token";
import { getPaylink, listPaylinks, upsertPaylink, type PaylinkProfile } from "@/lib/allot/store";

export const dynamic = "force-dynamic";

const UpdatePaylinkSchema = z.object({
  handle: z.string().min(2).max(40),
  displayName: z.string().min(1).max(80).optional(),
  roleTitle: z.string().max(120).optional(),
  defaultInvoiceUsd: z.number().min(5).max(500_000).optional(),
  rule: z.any().optional(),
});

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  const token = req.nextUrl.searchParams.get("d");
  if (handle) {
    const profile = getPaylink(handle);
    if (profile) {
      return NextResponse.json({ paylink: profile });
    }
    const decoded = decodeSharePayload<PaylinkProfile>(token);
    if (decoded && decoded.handle === handle.toLowerCase() && decoded.userId) {
      return NextResponse.json({ paylink: decoded });
    }
    return NextResponse.json({ error: "Paylink not found" }, { status: 404 });
  }
  return NextResponse.json({ paylinks: listPaylinks() });
}

export async function POST(req: NextRequest) {
  try {
    const body = UpdatePaylinkSchema.parse(await req.json());
    const existing = getPaylink(body.handle);
    if (!existing) {
      return NextResponse.json({ error: "Paylink not found" }, { status: 404 });
    }
    const updated = upsertPaylink({
      ...existing,
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.roleTitle ? { roleTitle: body.roleTitle } : {}),
      ...(body.defaultInvoiceUsd ? { defaultInvoiceUsd: body.defaultInvoiceUsd } : {}),
      ...(body.rule ? { rule: body.rule } : {}),
    });
    return NextResponse.json({ paylink: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid paylink update", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update paylink" },
      { status: 500 },
    );
  }
}
