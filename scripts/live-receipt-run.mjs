import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

const BASE = process.env.TM_API_BASE || "https://api.truemarkets.co";
const ORG_KEY_PATH = process.env.TM_KEY_FILE || join(homedir(), ".config/truemarkets/allot-org-key.json");
const SIGNER_KEY_PATH = join(homedir(), ".config/truemarkets/allot-probe-signer.json");
const USER_ID = process.env.TM_QUOTE_USER_ID || "98f6006a-b96a-4b77-a9e8-69c1c85c308c";

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
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

async function mintToken() {
  const { key_id, private_key } = JSON.parse(readFileSync(ORG_KEY_PATH, "utf8"));
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = sign("sha256", Buffer.from(`${key_id}.${timestamp}`), {
    key: createPrivateKey({ key: private_key, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const res = await req("POST", "/v1/auth/api-key/token", { key_id, timestamp, signature: sig });
  if (!res.ok) throw new Error(`Auth failed: ${JSON.stringify(res.json)}`);
  return res.json.access_token;
}

async function main() {
  const token = await mintToken();
  const userHdr = { Authorization: `Bearer ${token}`, "TM-On-Behalf-Of": USER_ID };

  const balRes = await req("GET", "/v1/gateway/balances", undefined, userHdr);
  const balances = balRes.json?.data || [];
  console.log("Current Gateway balances:", JSON.stringify(balances, null, 2));

  const usdcBase = balances.find((b) => b.symbol === "USDC" && b.chain === "base");
  const usdcSol = balances.find((b) => b.symbol === "USDC" && b.chain === "solana");
  const baseAmt = Number(usdcBase?.available || 0);
  const solAmt = Number(usdcSol?.available || 0);

  if (baseAmt < 2 && solAmt < 2) {
    console.log("\nWallet not yet funded with >= $2 USDC on Base or Solana.");
    console.log("  Base USDC address:   0x7DAe0C02233864D8748Ce54e5e658148fC259ac7");
    console.log("  Solana USDC address: CEMXtqVJGK5tYvBw9PeVLwTz2dKbkhxQhq31jVVRLVV");
    process.exit(0);
  }

  const signer = JSON.parse(readFileSync(SIGNER_KEY_PATH, "utf8"));
  const stamper = new ApiKeyStamper({
    apiPublicKey: signer.signer_public_key,
    apiPrivateKey: signer.signer_private_key,
  });
  const stamp = async (payload) => (await stamper.stamp(payload)).stampHeaderValue;

  const catRes = await req("GET", "/v1/gateway/assets?asset_class=stock");
  const assets = catRes.json?.data || [];

  const useBase = baseAmt >= 2;
  const available = useBase ? baseAmt : solAmt;
  const targetSymbols = useBase ? ["AAPLC", "NVDAC"] : ["AAPLX", "NVDAX"];
  const chain = useBase ? "base" : "solana";

  // Protect 40% (at least $1) as Cash Floor, invest remaining surplus across 2 stocks (each >= $1.50)
  const floorUsd = Math.max(1, Number((available * 0.35).toFixed(2)));
  const surplusUsd = Number((available - floorUsd).toFixed(2));
  const legsToRun =
    surplusUsd >= 3.2
      ? [
          { symbol: targetSymbols[0], usd: Number((surplusUsd * 0.55).toFixed(2)) },
          { symbol: targetSymbols[1], usd: Number((surplusUsd * 0.45).toFixed(2)) },
        ]
      : [{ symbol: targetSymbols[0], usd: Number(Math.max(1.5, surplusUsd).toFixed(2)) }];

  console.log(
    `\nExecuting LIVE GATEWAY payday split on ${chain.toUpperCase()}: available=$${available.toFixed(2)}, cashFloor=$${floorUsd.toFixed(2)}, legs=${JSON.stringify(legsToRun)}`,
  );

  const results = [];
  for (const leg of legsToRun) {
    const asset = assets.find((a) => a.symbol === leg.symbol && a.chain === chain && a.venue === "defi");
    if (!asset) throw new Error(`Asset ${leg.symbol} on ${chain} not found`);

    const hist = await req("GET", `/v1/defi/market/prices/history?symbol=${leg.symbol}&window=1h`);
    const pts = hist.json?.points || [];
    const benchmarkPrice = pts.length ? Number(pts[pts.length - 1].price) : null;

    console.log(`\n→ Creating live order: BUY $${leg.usd} of ${leg.symbol} (${asset.id})...`);
    const created = await req(
      "POST",
      "/v1/gateway/orders",
      {
        asset_id: asset.id,
        qty: leg.usd.toFixed(2),
        qty_unit: "quote",
        side: "buy",
        type: "market",
      },
      userHdr,
    );
    console.log("  Create response:", created.status, JSON.stringify(created.json).slice(0, 400));
    if (!created.ok || !created.json?.order_id) {
      results.push({ symbol: leg.symbol, error: created.json });
      continue;
    }

    const payloads = created.json.payloads || [];
    const signatures = [];
    for (const p of payloads) {
      signatures.push(await stamp(p.payload));
    }

    const executed = await req(
      "POST",
      `/v1/gateway/orders/${created.json.order_id}/execute`,
      { signatures, auth_type: "api_key" },
      userHdr,
    );
    console.log("  Execute response:", executed.status, JSON.stringify(executed.json));

    let finalOrder = executed.json;
    for (let i = 0; i < 10 && !["complete", "canceled", "failed"].includes(finalOrder?.status); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const polled = await req("GET", `/v1/gateway/orders/${created.json.order_id}`, undefined, userHdr);
      finalOrder = polled.json;
      console.log(`  Poll #${i + 1}: status=${finalOrder?.status}`);
    }

    results.push({
      symbol: leg.symbol,
      name: asset.name,
      economicAssetId: asset.economic_asset_id,
      chain,
      venue: "defi",
      orderId: created.json.order_id,
      requestedUsd: leg.usd,
      benchmarkPrice,
      quote: created.json.quote,
      finalOrder,
      stampPreview: signatures[0] ? `${signatures[0].slice(0, 22)}…${signatures[0].slice(-12)}` : "",
    });
  }

  const outPath = join(process.cwd(), ".data/live-gateway-capture.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        userId: USER_ID,
        chain,
        availableBeforeUsd: available,
        cashFloorUsd: floorUsd,
        signerPublicKey: signer.signer_public_key,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ Saved live capture to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
