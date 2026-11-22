import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { generateP256KeyPair } from "@turnkey/crypto";
import type { CompiledPaydayPlan, PaycheckRule } from "./types";

function computeSpreadBps(quotePrice: number, marketPrice: number): number {
  return Number((((quotePrice - marketPrice) / marketPrice) * 10_000).toFixed(2));
}

export interface LocalP256SignerVault {
  publicKeyCompressedHex: string;
  privateKeyHex: string;
  createdAt: string;
  fingerprint: string;
}

const STORAGE_KEY = "allot.p256.signer.vault.v1";

export function makeKeyFingerprint(publicKeyHex: string): string {
  if (publicKeyHex.length < 16) return publicKeyHex;
  return `${publicKeyHex.slice(0, 8)}…${publicKeyHex.slice(-8)}`;
}

export function createP256SignerVault(): LocalP256SignerVault {
  const { publicKey, privateKey } = generateP256KeyPair();
  return {
    publicKeyCompressedHex: publicKey,
    privateKeyHex: privateKey,
    createdAt: new Date().toISOString(),
    fingerprint: makeKeyFingerprint(publicKey),
  };
}

export function loadOrCreateBrowserVault(): LocalP256SignerVault {
  if (typeof window === "undefined") {
    throw new Error("loadOrCreateBrowserVault can only run in the browser");
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as LocalP256SignerVault;
      if (parsed.publicKeyCompressedHex && parsed.privateKeyHex) {
        return parsed;
      }
    } catch {
      // fall through to regenerate
    }
  }
  const created = createP256SignerVault();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(created));
  return created;
}

/**
 * Independent client-side verification before signing any True Markets payload.
 * Guarantees the server cannot silently lower the user's cash floor or widen maxDriftBps.
 */
export function verifyPlanAgainstLocalRule(
  plan: CompiledPaydayPlan,
  localRule: PaycheckRule,
): { ok: true } | { ok: false; code: "SIGNER_REQUIRED"; reason: string } {
  if (plan.cashFloorCents < localRule.cashFloorCents) {
    return {
      ok: false,
      code: "SIGNER_REQUIRED",
      reason: `Plan cash floor ($${(plan.cashFloorCents / 100).toFixed(2)}) is below local rule ($${(localRule.cashFloorCents / 100).toFixed(2)}). Signing refused.`,
    };
  }
  if (plan.protectedCashCents < Math.min(plan.totalCashBeforeCents, localRule.cashFloorCents)) {
    return {
      ok: false,
      code: "SIGNER_REQUIRED",
      reason: "Plan breaches local protected cash floor. Signing refused.",
    };
  }
  for (const leg of plan.legs) {
    if (leg.action === "EXECUTE_DEFI_MARKET") {
      if (leg.driftBps === null || leg.marketPrice === null) {
        return {
          ok: false,
          code: "SIGNER_REQUIRED",
          reason: `Leg ${leg.symbol} is missing a verified reference price. Signing refused.`,
        };
      }
      if (leg.driftBps > localRule.maxDriftBps) {
        return {
          ok: false,
          code: "SIGNER_REQUIRED",
          reason: `Leg ${leg.symbol} market drift (+${leg.driftBps} bps) exceeds local cap (${localRule.maxDriftBps} bps). Signing refused.`,
        };
      }
    }
  }
  return { ok: true };
}

export interface PreparedOrderQuoteCheckInput {
  symbol: string;
  orderType: "market" | "limit";
  benchmarkPrice: number | null;
  maxDriftBps: number;
  preparedQuote?: {
    price?: string;
    qty?: string;
    qty_out?: string;
  } | null;
}

export type PreparedOrderQuoteCheckResult =
  | { ok: true; preparedPrice: number | null; preparedDriftBps: number | null }
  | {
      ok: false;
      code: "MISSING_REFERENCE_PRICE" | "PREPARED_QUOTE_DRIFT_EXCEEDED";
      preparedPrice: number | null;
      preparedDriftBps: number | null;
      reason: string;
    };

/**
 * Re-verifies the fresh quote returned by POST /v1/gateway/orders immediately BEFORE
 * stamping/signing the Gateway payload. Closes the preview-to-prepare TOCTOU gap.
 */
export function verifyPreparedOrderQuote(
  input: PreparedOrderQuoteCheckInput,
): PreparedOrderQuoteCheckResult {
  // Resting limit orders enforce their own explicit limit price on the CLOB.
  if (input.orderType === "limit") {
    return { ok: true, preparedPrice: null, preparedDriftBps: null };
  }

  if (
    input.benchmarkPrice === null ||
    !Number.isFinite(input.benchmarkPrice) ||
    input.benchmarkPrice <= 0
  ) {
    return {
      ok: false,
      code: "MISSING_REFERENCE_PRICE",
      preparedPrice: null,
      preparedDriftBps: null,
      reason: `Cannot verify prepared ${input.symbol} order without a live reference price. Signing refused.`,
    };
  }

  const q = input.preparedQuote;
  let preparedPrice: number | null = null;
  if (q?.price && Number(q.price) > 0) {
    preparedPrice = Number(q.price);
  } else if (q?.qty && q?.qty_out && Number(q.qty) > 0 && Number(q.qty_out) > 0) {
    preparedPrice = Number(q.qty) / Number(q.qty_out);
  }

  if (preparedPrice === null || !Number.isFinite(preparedPrice) || preparedPrice <= 0) {
    return {
      ok: false,
      code: "PREPARED_QUOTE_DRIFT_EXCEEDED",
      preparedPrice: null,
      preparedDriftBps: null,
      reason: `Gateway prepared order for ${input.symbol} omitted a verifiable execution quote. Re-quoting required before signing.`,
    };
  }

  const preparedDriftBps = computeSpreadBps(preparedPrice, input.benchmarkPrice);
  if (preparedDriftBps > input.maxDriftBps) {
    return {
      ok: false,
      code: "PREPARED_QUOTE_DRIFT_EXCEEDED",
      preparedPrice,
      preparedDriftBps,
      reason: `Prepared ${input.symbol} order drifted to $${preparedPrice.toFixed(2)} (+${preparedDriftBps.toFixed(1)} bps vs $${input.benchmarkPrice.toFixed(2)} reference), exceeding your ${input.maxDriftBps} bps cap. Signing refused — re-plan triggered.`,
    };
  }

  return { ok: true, preparedPrice, preparedDriftBps };
}

/**
 * Produces the exact Turnkey X-Stamp value expected by True Markets Gateway
 * (`SIGNATURE_SCHEME_TK_API_P256`) for any unsigned Gateway order/transfer/cancel payload.
 */
export async function stampGatewayPayload(
  vault: LocalP256SignerVault,
  payload: string,
): Promise<string> {
  const stamper = new ApiKeyStamper({
    apiPublicKey: vault.publicKeyCompressedHex,
    apiPrivateKey: vault.privateKeyHex,
  });
  const stamped = await stamper.stamp(payload);
  return stamped.stampHeaderValue;
}
