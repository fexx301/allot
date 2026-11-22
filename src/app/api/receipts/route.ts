import { NextRequest, NextResponse } from "next/server";
import { getReceipt, listReceipts } from "@/lib/allot/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const receipt = getReceipt(id);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }
    return NextResponse.json({ receipt });
  }
  return NextResponse.json({ receipts: listReceipts() });
}
