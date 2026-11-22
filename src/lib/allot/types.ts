import type { GatewayVenue } from "../tm-gateway/types";

export interface SplitLegConfig {
  economicAssetId: string;
  symbol: string;
  name: string;
  weightPct: number; // 0..100 integer or 2dp; sum across legs <= 100
}

export interface PaycheckRule {
  ruleId: string;
  label: string;
  cashFloorCents: number; // Protected rent/bills USDC floor in integer cents
  maxDriftBps: number; // Max allowed spread above live reference/market price before refusing market fill
  minNotionalCents: number; // Minimum order notional per leg (default 200 = $2.00; TM exchange floor is $1.00)
  autoStageClobLimit: boolean; // When drifted & paired CeFi listing exists, stage resting CLOB limit order
  legs: SplitLegConfig[];
}

export interface LiveAssetQuoteSnapshot {
  economicAssetId: string;
  symbol: string;
  name: string;
  icon: string;
  defiAssetId: string | null;
  defiChain: string | null;
  cefiAssetId: string | null;
  supportsClobLimit: boolean;
  marketPrice: number | null; // Live True Markets Market Data price
  marketPriceTimestamp: string | null;
  quotePrice: number | null; // Live Gateway POST /quotes price on DeFi listing
  quoteQty: number | null;
  quoteFeeUsd: number | null;
  quoteError: string | null;
}

export type LegDecisionAction =
  | "EXECUTE_DEFI_MARKET"
  | "STAGE_CEFI_LIMIT"
  | "CARRIED_OVER"
  | "BLOCKED_DRIFT_NO_CLOB"
  | "BLOCKED_NO_REFERENCE"
  | "BLOCKED_NO_QUOTE";

export type RefusalCode =
  | "CASH_FLOOR_PROTECTED"
  | "PRICE_DRIFT_GUARDED"
  | "MISSING_REFERENCE_PRICE"
  | "BELOW_MIN_NOTIONAL"
  | "BLOCKED_DRIFT_NO_CLOB"
  | "NO_LIVE_QUOTE"
  | "PREPARED_QUOTE_DRIFT_EXCEEDED"
  | "SIGNER_REQUIRED";

export interface CompiledLeg {
  economicAssetId: string;
  symbol: string;
  name: string;
  icon: string;
  weightPct: number;
  allocatedCents: number;
  effectiveCents: number; // allocatedCents + prior carryover for this leg
  action: LegDecisionAction;
  reasonCode: RefusalCode | "APPROVED";
  reasonMessage: string;
  targetVenue: GatewayVenue | null;
  targetAssetId: string | null;
  targetChain: string | null;
  orderType: "market" | "limit" | null;
  qtyUnit: "quote" | "base" | null;
  orderQty: string | null; // Decimal string ready for POST /v1/gateway/orders
  limitPrice: string | null; // Tick-quantized limit price for STAGE_CEFI_LIMIT
  marketPrice: number | null;
  quotePrice: number | null;
  quoteFeeUsd: number | null;
  driftBps: number | null;
  estimatedSavingsUsd: number;
  carryoverDeltaCents: number; // New carryover stored if BELOW_MIN_NOTIONAL
}

export interface CompiledPaydayPlan {
  planVersion: "allot.plan.v1";
  depositEventId: string;
  compiledAt: string;
  mode: "LIVE_QUOTES_PREVIEW" | "LIVE_GATEWAY";
  incomingCents: number;
  existingCashCents: number;
  totalCashBeforeCents: number;
  cashFloorCents: number;
  protectedCashCents: number; // Cash kept in USDC (floor + unallocated % + blocked/carried legs)
  allocatableSurplusCents: number;
  cashRetainedByRuleCents: number; // Remainder if weights sum < 100%
  planStatus: "READY_TO_SIGN" | "REFUSED_CASH_FLOOR" | "NO_EXECUTABLE_LEGS";
  refusalSummary: RefusalCode[];
  legs: CompiledLeg[];
  totals: {
    executableMarketCents: number;
    stagedLimitCents: number;
    carriedOverCents: number;
    blockedCents: number;
    estimatedSavingsUsd: number;
  };
  ruleSnapshot: PaycheckRule;
  planHash: string;
}

export interface PaydayReceipt {
  receiptId: string;
  createdAt: string;
  mode: "LIVE_GATEWAY" | "LIVE_QUOTES_PREVIEW";
  userHandle: string;
  userId: string;
  signerPublicKey: string;
  planHash: string;
  signerProof: {
    verifiedLocalPlanHash: boolean;
    stampPreview: string;
    scheme: "SIGNATURE_SCHEME_TK_API_P256";
  };
  plan: CompiledPaydayPlan;
  executions: Array<{
    symbol: string;
    venue: GatewayVenue;
    chain?: string;
    orderType: "market" | "limit";
    orderId: string;
    status: string;
    requestedUsd: number;
    executedQty?: string;
    fillPrice?: number;
    benchmarkPrice?: number;
    driftBps?: number;
    feeUsd?: number;
    txHash?: string;
  }>;
}
