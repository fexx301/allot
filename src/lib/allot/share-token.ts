import { deflateSync, inflateSync } from "node:zlib";
import type { PaydayReceipt } from "./types";
import type { PaylinkProfile } from "./store";

/**
 * Stateless, URL-safe compressed tokens so newly created /receipt/[id] and /pay/[handle]
 * links never disappear across Vercel serverless cold starts or multiple instances.
 */
export function encodeSharePayload(data: unknown): string {
  const json = JSON.stringify(data);
  const compressed = deflateSync(Buffer.from(json, "utf8"));
  return compressed.toString("base64url");
}

export function decodeSharePayload<T>(token: string | null | undefined): T | null {
  if (!token || token.length > 32_000) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    const raw = inflateSync(buf).toString("utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function buildReceiptSharePath(receipt: PaydayReceipt): string {
  // Keep URL compact by encoding the receipt cleanly
  const token = encodeSharePayload(receipt);
  return `/receipt/${encodeURIComponent(receipt.receiptId)}?d=${token}`;
}

export function buildPaylinkSharePath(profile: PaylinkProfile): string {
  const token = encodeSharePayload(profile);
  return `/pay/${encodeURIComponent(profile.handle)}?d=${token}`;
}
