import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

// Usage: RETURN_TO=0xYourAddress node scripts/recover-funds.mjs
const BASE = process.env.TM_API_BASE || "https://api.truemarkets.co";
const ORG_KEY_PATH = process.env.TM_KEY_FILE || join(homedir(), ".config/truemarkets/allot-org-key.json");
const SIGNER_KEY_PATH = join(homedir(), ".config/truemarkets/allot-probe-signer.json");
const USER_ID = process.env.TM_QUOTE_USER_ID || "98f6006a-b96a-4b77-a9e8-69c1c85c308c";
const RETURN_TO = process.env.RETURN_TO;

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ok: res.ok, json: await res.json().catch(() => null) };
}

async function main() {
  const { key_id, private_key } = JSON.parse(readFileSync(ORG_KEY_PATH, "utf8"));
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = sign("sha256", Buffer.from(`${key_id}.${timestamp}`), {
    key: createPrivateKey({ key: private_key, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const auth = await req("POST", "/v1/auth/api-key/token", { key_id, timestamp, signature: sig });
  const hdr = { Authorization: `Bearer ${auth.json.access_token}`, "TM-On-Behalf-Of": USER_ID };

  const signer = JSON.parse(readFileSync(SIGNER_KEY_PATH, "utf8"));
  const stamper = new ApiKeyStamper({
    apiPublicKey: signer.signer_public_key,
    apiPrivateKey: signer.signer_private_key,
  });
  const stamp = async (p) => (await stamper.stamp(p)).stampHeaderValue;

  // 1. Sell any non-USDC holdings back to USDC
  const bal1 = (await req("GET", "/v1/gateway/balances", undefined, hdr)).json?.data || [];
  for (const b of bal1) {
    if (b.symbol === "USDC" || !b.asset_id || Number(b.available) <= 0) continue;
    console.log(`Selling ${b.available} ${b.symbol} (${b.chain}) back to USDC...`);
    const ord = await req(
      "POST",
      "/v1/gateway/orders",
      { asset_id: b.asset_id, qty: b.available, qty_unit: "base", side: "sell", type: "market" },
      hdr,
    );
    if (ord.ok && ord.json?.order_id) {
      const sigs = await Promise.all((ord.json.payloads || []).map((p) => stamp(p.payload)));
      const ex = await req(
        "POST",
        `/v1/gateway/orders/${ord.json.order_id}/execute`,
        { signatures: sigs, auth_type: "api_key" },
        hdr,
      );
      console.log("  Sold:", ex.status, ex.json);
    } else {
      console.log("  Sell skipped/error:", ord.status, ord.json);
    }
  }

  if (!RETURN_TO) {
    console.log("\nAll stock tokens sold to USDC. Set RETURN_TO=<address> to withdraw USDC.");
    return;
  }

  await new Promise((r) => setTimeout(r, 3000));
  const bal2 = (await req("GET", "/v1/gateway/balances", undefined, hdr)).json?.data || [];
  const targetChain = RETURN_TO.startsWith("0x") ? "base" : "solana";
  const usdc = bal2.find((b) => b.symbol === "USDC" && b.chain === targetChain && Number(b.available) > 0);
  if (!usdc || !usdc.asset_id) {
    console.log(`No available USDC found on ${targetChain}. Balances:`, bal2);
    return;
  }

  console.log(`Withdrawing ${usdc.available} USDC on ${targetChain} -> ${RETURN_TO}...`);
  const tr = await req(
    "POST",
    "/v1/gateway/transfers",
    { asset_id: usdc.asset_id, qty: usdc.available, qty_unit: "base", to: RETURN_TO },
    hdr,
  );
  if (tr.ok && (tr.json?.transfer_id || tr.json?.id)) {
    const id = tr.json.transfer_id || tr.json.id;
    const sigs = await Promise.all((tr.json.payloads || []).map((p) => stamp(p.payload)));
    const ex = await req(
      "POST",
      `/v1/gateway/transfers/${id}/execute`,
      { signatures: sigs, auth_type: "api_key" },
      hdr,
    );
    console.log("Withdrawal executed:", ex.status, ex.json);
  } else {
    console.log("Transfer error:", tr.status, tr.json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
