import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

// Tests a passive ($0-fee, below-market) CeFi CLOB limit order lifecycle:
// create (venue: "cefi", Bucket-5 0.001 tick/lot) -> P-256 sign/execute -> PATCH price -> P-256 cancel
const BASE = process.env.TM_API_BASE || "https://api.truemarkets.co";
const ORG_KEY_PATH = process.env.TM_KEY_FILE || join(homedir(), ".config/truemarkets/allot-org-key.json");
const SIGNER_KEY_PATH = join(homedir(), ".config/truemarkets/allot-probe-signer.json");
const USER_ID = process.env.TM_QUOTE_USER_ID || "98f6006a-b96a-4b77-a9e8-69c1c85c308c";

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

async function main() {
  const { key_id, private_key } = JSON.parse(readFileSync(ORG_KEY_PATH, "utf8"));
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign("sha256", Buffer.from(`${key_id}.${ts}`), {
    key: createPrivateKey({ key: private_key, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const auth = await req("POST", "/v1/auth/api-key/token", { key_id, timestamp: ts, signature: sig });
  const hdr = { Authorization: `Bearer ${auth.json.access_token}`, "TM-On-Behalf-Of": USER_ID };

  const signer = JSON.parse(readFileSync(SIGNER_KEY_PATH, "utf8"));
  const stamper = new ApiKeyStamper({
    apiPublicKey: signer.signer_public_key,
    apiPrivateKey: signer.signer_private_key,
  });
  const stamp = async (p) => (await stamper.stamp(p)).stampHeaderValue;

  const cat = await req("GET", "/v1/gateway/assets?asset_class=stock");
  const nvdaCefi = (cat.json?.data || []).find((a) => a.symbol === "NVDAC" && a.venue === "cefi");
  if (!nvdaCefi) throw new Error("NVDAC cefi listing not found");

  const hist = await req("GET", "/v1/defi/market/prices/history?symbol=NVDAC&window=1h");
  const pts = hist.json?.points || [];
  const marketPrice = Number(pts[pts.length - 1].price);

  // Passive resting buy ~2% below market (strictly Bucket 5: 0.001 tick, 0.001 lot, >= $1.50 notional)
  const limitPrice = (Math.floor((marketPrice * 0.98) / 0.001) * 0.001).toFixed(3);
  const patchedPrice = (Math.floor((marketPrice * 0.978) / 0.001) * 0.001).toFixed(3);
  const baseQty = (Math.ceil(1.6 / Number(limitPrice) / 0.001) * 0.001).toFixed(3);

  console.log("Market NVDAC:", marketPrice, "| Passive limit:", limitPrice, "| Qty:", baseQty, "| Notional:", (Number(limitPrice) * Number(baseQty)).toFixed(2));

  const created = await req(
    "POST",
    "/v1/gateway/orders",
    {
      asset_id: nvdaCefi.id,
      venue: "cefi",
      qty: baseQty,
      qty_unit: "base",
      side: "buy",
      type: "limit",
      price: limitPrice,
    },
    hdr,
  );
  console.log("1. CREATE CeFi limit:", created.status, JSON.stringify(created.json).slice(0, 600));

  const log = {
    capturedAt: new Date().toISOString(),
    symbol: "NVDAC",
    cefiAssetId: nvdaCefi.id,
    marketPrice,
    limitPrice,
    patchedPrice,
    baseQty,
    created: { status: created.status, orderId: created.json?.order_id, orderStatus: created.json?.status, quote: created.json?.quote, error: created.ok ? null : created.json },
  };

  if (created.ok && created.json?.order_id) {
    const orderId = created.json.order_id;
    const payloads = created.json.payloads || [];
    if (payloads.length > 0) {
      const signatures = await Promise.all(payloads.map((p) => stamp(p.payload)));
      const exec = await req(
        "POST",
        `/v1/gateway/orders/${orderId}/execute`,
        { signatures, auth_type: "api_key" },
        hdr,
      );
      console.log("2. EXECUTE CeFi limit:", exec.status, JSON.stringify(exec.json));
      log.executed = { status: exec.status, body: exec.json };
    }

    // Poll briefly until active or settled
    let current = await req("GET", `/v1/gateway/orders/${orderId}`, undefined, hdr);
    for (let i = 0; i < 8 && current.json?.status === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      current = await req("GET", `/v1/gateway/orders/${orderId}`, undefined, hdr);
      console.log(`   Poll #${i + 1}: status=${current.json?.status}`);
    }
    console.log("3. READ CeFi limit:", current.status, JSON.stringify(current.json));
    log.afterExecute = current.json;

    if (current.json?.status === "active") {
      // PATCH resting price
      const mod = await req("PATCH", `/v1/gateway/orders/${orderId}`, { price: patchedPrice }, hdr);
      console.log("4. PATCH CeFi limit:", mod.status, JSON.stringify(mod.json));
      log.modified = { status: mod.status, body: mod.json };

      // Cancel cleanly so zero funds stay locked
      const canc = await req("POST", `/v1/gateway/orders/${orderId}/cancel`, {}, hdr);
      console.log("5. CANCEL prepare:", canc.status, JSON.stringify(canc.json).slice(0, 400));
      log.cancelPrepared = { status: canc.status, statusVal: canc.json?.status, payloadCount: (canc.json?.payloads || []).length };

      if (canc.ok && (canc.json?.payloads || []).length > 0) {
        const cancelSigs = await Promise.all(canc.json.payloads.map((p) => stamp(p.payload)));
        const cancExec = await req(
          "POST",
          `/v1/gateway/orders/${orderId}/cancel/execute`,
          { signatures: cancelSigs, auth_type: "api_key" },
          hdr,
        );
        console.log("6. CANCEL execute:", cancExec.status, JSON.stringify(cancExec.json));
        log.cancelExecuted = { status: cancExec.status, body: cancExec.json };
      }
      const finalRead = await req("GET", `/v1/gateway/orders/${orderId}`, undefined, hdr);
      console.log("7. FINAL READ:", finalRead.status, JSON.stringify(finalRead.json));
      log.finalOrder = finalRead.json;
    }
  }

  writeFileSync(join(process.cwd(), ".data/live-cefi-limit-probe.json"), JSON.stringify(log, null, 2));
  console.log("Saved probe log to .data/live-cefi-limit-probe.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
