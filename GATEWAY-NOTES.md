# True Markets Gateway — Production Field Notes (Ecosystem Give-Back)

Practical production behaviors verified live against `https://api.truemarkets.co` and `wss://api.truemarkets.co/v1/defi/market` on **2026-11-22** while building **Allot**. Shared to help other Gateway builders ship faster without hitting hidden sharp edges.

---

## 1. Dual-Venue Stock Catalog Structure (`economic_asset_id`)
- `GET /v1/gateway/assets?asset_class=stock` (no auth required) returns **136 active tokenized U.S. stock listings** across **122 unique `economic_asset_id`s** (89 Robinhood, 25 Coinbase, 22 Solana).
- **Critical split:** All **122 `defi`** stock listings expose `order_types: ["market"]` only. Only the **14 paired `cefi` listings** (`AAPLC`, `AMZNC`, `GOOGLC`, `METAC`, `MSFTC`, `MSTRC`, `MUC`, `NVDA`, `NVDAC`, `PLTRC`, `SNDKC`, `SPCXC`, `TSLA`, `TSLAC`) expose `order_types: ["market", "limit"]`.
- **Builder pattern:** Group catalog entries by `economic_asset_id` so your router can pair instant DeFi market fills with resting CeFi CLOB limit fallback automatically (see `pairStockAssetsByEconomicId` in `src/lib/tm-gateway/client.ts`).

## 2. `POST /v1/gateway/quotes` Works on DeFi Stock Listings, Not CeFi Stock Listings
- Sending `asset_id` of a `defi` stock listing (`AAPLC` on Base, `qty_unit: "quote"`) returns `200 OK` with exact `qty`, `price`, `notional`, and `fee`.
- Sending a `cefi` stock `asset_id` to `POST /v1/gateway/quotes` returns `400 invalid_argument` — CeFi stock pricing comes from the Market Data REST/WebSocket feeds (`/v1/defi/market/prices/history`, `price.{SYMBOL}`, `reference.{SYMBOL}`) and executes via explicit CeFi CLOB orders.

## 3. Exact 9-Bucket CeFi Exchange Increment Schedule (`Bucket 5` Gotcha!)
- Per `docs.truemarkets.co/documentation/increment-sizes.md`, every `$10.00 – $999.999` stock (`AAPLC`, `NVDAC`, `SPCXC`, `TSLAC`, `MSFTC`) falls in **Bucket 5**, which enforces **`0.001` tick size** AND **`0.001` lot size (3 decimals)** — NOT 4 decimals (`0.0001`, which is Bucket 4 for `$1,000+` assets).
- Always pass explicit `venue: "cefi"` or `"defi"` on `POST /v1/gateway/orders` (otherwise `venue` defaults to `"smart"`) and quantize both `price` and `qty` strictly through the 9-bucket table (implemented & unit-tested in `src/lib/allot/compiler.ts`).

## 4. Permissionless DeFi Base Fills vs KYC-Gated CeFi CLOB Limit Orders
- **Verified live (`2026-11-22 08:38 UTC`):** Freshly provisioned Gateway users (`POST /v1/account/organizations/{id}/users`) can trade **`defi` Base tokenized stocks immediately with zero KYC**:
  - `AAPLC` ($2.14) → `200 complete`, `0.00612579` shares, fee `$0.00428` (**0.20% exact**), `$0` ETH gas (`d700e3f9-60bf-4872-b243-528f0065819d`).
  - `NVDAC` ($1.75) → `200 complete`, `0.01330083` shares, fee `$0.00350` (**0.20% exact**), `$0` ETH gas (`b7c2f046-f1fd-48cd-8a38-04448d636a2e`).
- **Verified live (`2026-11-22 10:12 UTC`):** Submitting a `venue: "cefi"` limit order (`NVDAC`, `type: "limit"`, Bucket-5 `0.001` tick/lot) for a non-KYC Gateway user returns **`403 permission_denied` (`code: "kyc_required"`, `"user not kyced"`, `request_id: 6c5fb5b0-4798-942e-b94d-343885930ca6`)**.
- **Production pattern:** Never silently downgrade a `403 kyc_required` CeFi limit order into an unguarded wide-spread DeFi market order — fail closed (`CEFI_KYC_REQUIRED`), hold that leg's USDC safely, and surface clear KYC unlock guidance.

## 5. Pre-Sign Prepared-Quote TOCTOU Verification
- Live weekend spreads on `AAPLC`, `NVDAC`, `SPCXC`, and `TSLAC` moved between **`-8 bps` and `+57 bps`** within minutes during our Sunday tests.
- Checking drift only on preview (`POST /v1/gateway/quotes`) leaves a window before `POST /v1/gateway/orders` returns unsigned payloads. Allot re-verifies the fresh `order.quote` returned by `/orders` inside `verifyPreparedOrderQuote()` **before** invoking the browser's ECDSA P-256 stamper (`SIGNATURE_SCHEME_TK_API_P256`), aborting signing (`PREPARED_QUOTE_DRIFT_EXCEEDED`) and triggering a re-plan if spreads spike.

## 6. Non-US/UK Serverless Pinning
- Tokenized stocks are restricted from US and UK IPs. Pinning Next.js serverless functions to **`fra1` (Frankfurt)** in `vercel.json` (`"regions": ["fra1"]`) keeps all catalog, quote, and execution calls unblocked in production (verified via `/api/health`).
