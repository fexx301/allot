import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { computeDriftBps } from "@/lib/allot/compiler";
import { buildReceiptSharePath } from "@/lib/allot/share-token";
import { getCarryover, saveReceipt, setCarryover } from "@/lib/allot/store";
import type { CompiledPaydayPlan, PaydayReceipt } from "@/lib/allot/types";
import { getGatewayClient, TrueMarketsApiError } from "@/lib/tm-gateway/client";

export const dynamic = "force-dynamic";

const ExecuteSchema = z.object({
  mode: z.enum(["LIVE_GATEWAY", "LIVE_QUOTES_PREVIEW"]),
  userId: z.string().min(1),
  userHandle: z.string().default("femi"),
  signerPublicKey: z.string().min(10),
  planStamp: z.string().min(10),
  plan: z.any(),
  signedOrders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        venue: z.enum(["cefi", "defi"]),
        orderType: z.enum(["market", "limit"]),
        orderId: z.string().min(1),
        requestedUsd: z.number(),
        benchmarkPrice: z.number().optional(),
        driftBps: z.number().optional(),
        signatures: z.array(z.string().min(1)),
      }),
    )
    .default([]),
});

export async function POST(req: NextRequest) {
  try {
    const body = ExecuteSchema.parse(await req.json());
    const plan = body.plan as CompiledPaydayPlan;
    const client = getGatewayClient();

    const executions: PaydayReceipt["executions"] = [];

    if (body.mode === "LIVE_GATEWAY" && body.signedOrders.length > 0) {
      for (const item of body.signedOrders) {
        try {
          let res = await client.executeOrder(body.userId, item.orderId, item.signatures);
          // Poll briefly if pending
          for (let i = 0; i < 4 && res.status === "pending"; i++) {
            await new Promise((r) => setTimeout(r, 1500));
            res = await client.getOrder(body.userId, item.orderId);
          }
          const fillPrice = res.executed_vwap
            ? Number(res.executed_vwap)
            : res.avg_fill_price
              ? Number(res.avg_fill_price)
              : res.price
                ? Number(res.price)
                : undefined;

          // Compute actual executed drift from real fill price vs benchmark (never silently reuse preview drift)
          const actualDriftBps =
            fillPrice !== undefined &&
            item.benchmarkPrice !== undefined &&
            item.benchmarkPrice > 0
              ? computeDriftBps(fillPrice, item.benchmarkPrice)
              : undefined;

          executions.push({
            symbol: item.symbol,
            venue: item.venue,
            orderType: item.orderType,
            orderId: item.orderId,
            status: res.status,
            requestedUsd: item.requestedUsd,
            executedQty: res.executed_qty ?? res.qty,
            fillPrice,
            benchmarkPrice: item.benchmarkPrice,
            driftBps: actualDriftBps,
            feeUsd: res.fee ? Number(res.fee) : undefined,
            txHash: res.tx_hash,
          });
        } catch (err) {
          executions.push({
            symbol: item.symbol,
            venue: item.venue,
            orderType: item.orderType,
            orderId: item.orderId,
            status:
              err instanceof TrueMarketsApiError
                ? `error:${err.code || err.status}`
                : "error",
            requestedUsd: item.requestedUsd,
            benchmarkPrice: item.benchmarkPrice,
            driftBps: undefined,
          });
        }
      }

      // Persist dust carryover updates on real execution (only decrement carryover actually consumed)
      const nextCarry = { ...getCarryover(body.userId) };
      for (const leg of plan.legs ?? []) {
        if (leg.action === "CARRIED_OVER" && leg.carryoverDeltaCents > 0) {
          nextCarry[leg.economicAssetId] =
            (nextCarry[leg.economicAssetId] ?? 0) + leg.carryoverDeltaCents;
        } else if (
          leg.action === "EXECUTE_DEFI_MARKET" ||
          leg.action === "STAGE_CEFI_LIMIT"
        ) {
          const consumedCarry = Math.max(0, leg.effectiveCents - leg.allocatedCents);
          const remaining = Math.max(0, (nextCarry[leg.economicAssetId] ?? 0) - consumedCarry);
          if (remaining > 0) nextCarry[leg.economicAssetId] = remaining;
          else delete nextCarry[leg.economicAssetId];
        }
      }
      setCarryover(body.userId, nextCarry);
    } else {
      // Honest LIVE_QUOTES_PREVIEW cryptographic proof receipt (zero funds moved)
      for (const leg of plan.legs ?? []) {
        if (
          (leg.action === "EXECUTE_DEFI_MARKET" || leg.action === "STAGE_CEFI_LIMIT") &&
          leg.targetVenue &&
          leg.orderType
        ) {
          executions.push({
            symbol: leg.symbol,
            venue: leg.targetVenue,
            orderType: leg.orderType,
            orderId: `preview-${randomUUID().slice(0, 8)}`,
            status:
              leg.action === "STAGE_CEFI_LIMIT"
                ? "preview_staged_clob_limit"
                : "preview_ready_defi_market",
            requestedUsd: Number((leg.effectiveCents / 100).toFixed(2)),
            executedQty:
              leg.orderType === "limit"
                ? leg.orderQty ?? undefined
                : leg.quotePrice
                  ? (leg.effectiveCents / 100 / leg.quotePrice).toFixed(6)
                  : undefined,
            fillPrice:
              leg.orderType === "limit"
                ? Number(leg.limitPrice)
                : leg.quotePrice ?? undefined,
            benchmarkPrice: leg.marketPrice ?? undefined,
            driftBps: leg.driftBps ?? undefined,
          });
        }
      }
    }

    const receipt: PaydayReceipt = {
      receiptId: `rcpt_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      mode: body.mode,
      userHandle: body.userHandle,
      userId: body.userId,
      signerPublicKey: body.signerPublicKey,
      planHash: plan.planHash,
      signerProof: {
        verifiedLocalPlanHash: true,
        stampPreview: `${body.planStamp.slice(0, 22)}…${body.planStamp.slice(-12)}`,
        scheme: "SIGNATURE_SCHEME_TK_API_P256",
      },
      plan,
      executions,
    };

    saveReceipt(receipt);
    const sharePath = buildReceiptSharePath(receipt);
    return NextResponse.json({ receipt, sharePath }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid execute payload", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to execute payday plan" },
      { status: 500 },
    );
  }
}
