import { NextRequest, NextResponse } from "next/server";
import { decodeSharePayload } from "@/lib/allot/share-token";
import { getReceipt, listReceipts } from "@/lib/allot/store";
import type { PaydayReceipt } from "@/lib/allot/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const token = req.nextUrl.searchParams.get("d");
  if (id) {
    const stored = getReceipt(id);
    if (stored) {
      return NextResponse.json({ receipt: stored });
    }
    const decoded = decodeSharePayload<PaydayReceipt>(token);
    if (decoded && decoded.receiptId === id && decoded.planHash && decoded.plan) {
      return NextResponse.json({ receipt: decoded });
    }
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  return NextResponse.json({ receipts: listReceipts() });
}
