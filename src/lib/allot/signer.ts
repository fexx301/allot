import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { generateP256KeyPair } from "@turnkey/crypto";
import type { CompiledPaydayPlan, PaycheckRule } from "./types";

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
    if (
      leg.action === "EXECUTE_DEFI_MARKET" &&
      leg.driftBps !== null &&
      leg.driftBps > localRule.maxDriftBps
    ) {
      return {
        ok: false,
        code: "SIGNER_REQUIRED",
        reason: `Leg ${leg.symbol} market drift (+${leg.driftBps} bps) exceeds local cap (${localRule.maxDriftBps} bps). Signing refused.`,
      };
    }
  }
  return { ok: true };
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
