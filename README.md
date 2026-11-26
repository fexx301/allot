<p align="left">
  <img src="public/allot-logo.svg" alt="Allot - Non-Custodial Global 401(k) in U.S. Stocks" height="52" />
</p>

# Allot: Non-Custodial Global 401(k) in U.S. Stocks

**Live Demo (EU `fra1`):** [https://allot-ashen.vercel.app](https://allot-ashen.vercel.app) · **Demo Video (1:38):** [https://youtu.be/H9uPsR0_h74](https://youtu.be/H9uPsR0_h74) · **Live Base Mainnet Receipt:** [`/receipt/rcpt_live_base_20261122`](https://allot-ashen.vercel.app/receipt/rcpt_live_base_20261122) · **Live Gateway Health:** [`/api/health`](https://allot-ashen.vercel.app/api/health)

> **Keep your rent safe. Put the rest into U.S. stocks.**

Allot is a non-custodial "Global 401(k)" for people paid in USDC. Set two rules once: how much cash to always keep for rent, and the most you'll pay above market. Each paycheck then splits into tokenized U.S. stocks on True Markets Gateway the moment you approve it with one signature in your browser. Your signing key never leaves your device.

**It's live:** a real $5.98 USDC paycheck on Base mainnet. $2.09 rent floor kept, $3.89 bought into Apple and NVIDIA, $0.00778 total fees, $0 gas ([receipt](https://allot-ashen.vercel.app/receipt/rcpt_live_base_20261122)).

### Three protections in one app

1. **Your rent floor is a hard lock.** If a paycheck doesn't clear your floor, nothing is bought ($850 invoice → $0 invested).
2. **It never overpays.** When a live quote is above your limit, Allot switches that stock from a DeFi market buy to a price-capped CeFi CLOB limit order (paired via `economic_asset_id`).
3. **It doesn't trust its own server.** Your browser re-checks every rule and the final price before signing. A tampered plan or a last-second price jump means nothing gets signed.

---

## Start Here: Verified Live Base Mainnet Receipt (`2026-11-22 08:38 UTC`)

Inspect directly in the live app at **[`/receipt/rcpt_live_base_20261122`](https://allot-ashen.vercel.app/receipt/rcpt_live_base_20261122)** (badged **`Real trade · verified on-chain`**).

Executed live on True Markets Gateway (`user_id: 98f6006a-b96a-4b77-a9e8-69c1c85c308c`) from a **$5.98 USDC** Base deposit (**$2.09 USDC** rent floor left untouched, **$3.89** split across Apple and NVIDIA, **$0.00778 total fees**, **$0 gas**, signed locally with ECDSA P-256 `SIGNATURE_SCHEME_TK_API_P256`):

| Leg | Allocation | Filled Qty | Executed VWAP | Actual Fill vs Market | Gateway Order ID | Base Mainnet Settlement Tx |
|---|---|---|---|---|---|---|
| **AAPLC** (Apple) | `$2.14` | `0.00612579` | `$349.3427` | `+0.12%` (fee `$0.00428`) | `d700e3f9-60bf-4872-b243-528f0065819d` | [`0x2c597e…5d79b5f`](https://basescan.org/tx/0x2c597e239af7072ef5911f1c65d04e4215b018dd464ce29fd3d0b88a05d79b5f) (Block `#60,731,764`) |
| **NVDAC** (NVIDIA) | `$1.75` | `0.01330083` | `$131.5707` | `+0.41%` (fee `$0.00350`) | `b7c2f046-f1fd-48cd-8a38-04448d636a2e` | [`0x5239d3…1274c1dc`](https://basescan.org/tx/0x5239d3f08950dc16a3782b756b3a3fd23026e8f15a9d130448016a3e1274c1dc) (Block `#60,731,772`) |
| **Protected Cash Floor** | `$2.09` | `2.085321 USDC` | - | Held untouched in user's Base Turnkey wallet | - | Verify live via [`/api/wallet`](https://allot-ashen.vercel.app/api/wallet) |

> **Why `/` opens in Preview Mode:** True Markets Gateway has no public sandbox and every order moves real funds (`docs.truemarkets.co/llms.txt`). Opening `/` loads **`Live True Markets Quotes · Preview Mode`** (real Gateway catalog, real market prices, and live `POST /v1/gateway/quotes`) so judges can test every protection in 60 seconds without depositing USDC first. The receipt above is a real settled Base mainnet trade, and clicking **Create Wallet** switches to live non-custodial execution on Base and Solana.

---

## Judge Path (2 Minutes, No Login)

0. **Watch the 1:38 demo video** attached to the DevSpot submission.
1. **Open Payday Studio (`https://allot-ashen.vercel.app`)**: no login required. Loads the live True Markets tokenized stock catalog (`GET /v1/gateway/assets?asset_class=stock`, including 14 dual-venue CLOB flagships: `AAPLC`, `NVDAC`, `MSFTC`, `AMZNC`, `GOOGLC`, `METAC`, `TSLAC`, `PLTRC`, and pre-IPO **`SPCXC` SpaceX**), the 24/7 live tape, live Market Data prices, and live `POST /v1/gateway/quotes`. Plain-language UI by default (`0.25%`, *Buying now*, *Limit order*); click **Technical details** on any plan card to inspect raw Gateway payloads, venues, quantities, and `economic_asset_id`s.
2. **Test the 3 live paydays (top cards):**
   - **$3,500 Remote Salary** (*Max price above market* = `0.25%`): tight quotes show **Buying now** (`DEFI MARKET`). Any stock quoting over `0.25%` above market switches to **Limit order <= $...** (`PRICE_DRIFT_GUARDED` -> paired `cefi` CLOB limit order via `economic_asset_id`, tick-quantized to True Markets' 9-bucket schedule).
   - **$850 Freelance Invoice** ($1,000 *Cash to always keep*): triggers **`CASH_FLOOR_PROTECTED`**. Stub locks (**Floor Locked**), every stock shows **Held · Cash floor**, and `0` orders are placed.
   - **$32 Micro-Payout** (`0.55%` limit): the 4% SpaceX slice (`$1.28`) shows **Next payday** (**`BELOW_MIN_NOTIONAL`** dust carryover) while the larger slices route cleanly.
3. **Try to break the safety checks:** on **Only you can approve this**, expand **Demo: try to break the safety checks**:
   - Tick **Server tampers with my cash floor**: simulates a compromised server lowering your cash floor; your browser re-checks local rules, displays *Blocked: the plan doesn't match your rules* (`SIGNER_REQUIRED`), and disables signing.
   - Tick **Price jumps right before signing** and click **Sign (price-jump test)** in the sticky bar: the prepared quote returns above your limit, client-side `verifyPreparedOrderQuote()` stops execution with zero P-256 signature sent, and the three-step panel shows *Price you saw -> Price at order time -> Your money is safe*.
4. **Sign & inspect a receipt (`/receipt/[id]`):** untick the demos and click **Sign & get receipt**. Your browser stamps the canonical SHA-256 `plan_hash` with its ECDSA P-256 key (`SIGNATURE_SCHEME_TK_API_P256`) and opens a stateless Payday Receipt (`Preview · no money moved`, shareable via `?d=` token and exportable as JSON).
5. **Rebalancer (`/rebalance`):** select **NVIDIA rallied 40%**. Overweight sells run before underweight buys (*Trade plan (sells run before buys)*), holdings inside the ±3% band are skipped (*On target · skip*), and wide spreads route to **Limit sell / Limit buy** CeFi CLOB orders. **Use my real holdings** pulls live `AAPLC`/`NVDAC` balances from Gateway.
6. **Real wallet, Paylink & Holdings (`/pay/[handle]` & `/orders`):** click **Create Wallet** on Payday Studio to call live `POST /v1/account/organizations/{id}/users` with your browser's compressed P-256 public key and receive real Base and Solana USDC deposit addresses. Share `/pay/femi` (QR, address copy, live balance check, HTML/React embed snippet). On `/orders`: live balances, **Update price** (`PATCH`), **Cancel order**, **Sell to USDC**, and **Withdraw cash** (`Sign & send USDC`) via `POST /v1/gateway/transfers`.

> Theme: the top-right button cycles **System / Light / Dark**. Keyboard-accessible throughout (`:focus-visible`, ARIA labels, native `<dialog>`).

---

## True Markets Features Used

| True Markets Feature | Endpoint / Protocol | How Allot Uses It (What Breaks Without It) |
|---|---|---|
| **Multi-Venue Stock Catalog & `economic_asset_id`** | `GET /v1/gateway/assets?asset_class=stock` | Discovers live tokenized U.S. stocks and pairs `defi` market-only listings with their matching `cefi` CLOB `limit` listings across 14 dual-venue flagships. |
| **No-Auth Real-Time Market Data (REST & WebSocket)** | `GET /v1/defi/market/prices/history`, `wss://api.truemarkets.co/v1/defi/market` | Streams the 24/7 live ticker tape and fetches real-time benchmark prices to measure exact execution spread on every leg. |
| **Live Pre-Trade Execution Quotes** | `POST /v1/gateway/quotes` | Retrieves live fill price, output quantity, and fee before compiling payday splits and rebalances. |
| **Programmatic Turnkey Sub-Account Wallets** | `POST /v1/account/organizations/{id}/users` + `TM-On-Behalf-Of` | Provisions non-custodial Base and Solana USDC wallets in 2 seconds from the browser's P-256 public key with zero seed phrases. |
| **Dual-Key P-256 Order Lifecycle (Market & CeFi CLOB Limit)** | `POST /v1/gateway/orders`, `/execute`, `PATCH /orders/{id}`, `POST /orders/{id}/cancel` | Org API key prepares `initialized` orders, while only the user's browser P-256 key (`SIGNATURE_SCHEME_TK_API_P256`) can sign and execute. Manages resting CeFi CLOB limit orders quantized to True Markets' 9-bucket tick/lot schedule. |
| **Live Balances & Instant Cash Withdrawals** | `GET /v1/gateway/balances`, `POST /v1/gateway/transfers` | Reads real USDC and stock holdings, detects incoming USDC paychecks, and allows instant P-256 signed withdrawal of the protected cash floor. |

---

## How to Verify the True Markets Integration

### 1. Verify the Live Production Deployment (No Key Required)
```bash
# Confirm live Org JWT authentication, EU fra1 routing, and live stock catalog count
curl -sS https://allot-ashen.vercel.app/api/health

# Confirm live paired DeFi/CeFi stock catalog keyed by economic_asset_id
curl -sS https://allot-ashen.vercel.app/api/catalog | head -c 500

# Confirm live Base mainnet balances (2.085321 USDC cash floor + AAPLC + NVDAC shares) from GET /v1/gateway/balances
curl -sS https://allot-ashen.vercel.app/api/wallet | head -c 500
```
- Open DevTools **Network** tab on `https://allot-ashen.vercel.app` and change any slider to inspect live `POST /api/plan` responses returning fresh True Markets quotes and spread calculations.
- Verify both real on-chain settlement transactions on BaseScan directly from [`/receipt/rcpt_live_base_20261122`](https://allot-ashen.vercel.app/receipt/rcpt_live_base_20261122):
  - `AAPLC`: [`0x2c597e239af7072ef5911f1c65d04e4215b018dd464ce29fd3d0b88a05d79b5f`](https://basescan.org/tx/0x2c597e239af7072ef5911f1c65d04e4215b018dd464ce29fd3d0b88a05d79b5f) (Block `#60,731,764`)
  - `NVDAC`: [`0x5239d3f08950dc16a3782b756b3a3fd23026e8f15a9d130448016a3e1274c1dc`](https://basescan.org/tx/0x5239d3f08950dc16a3782b756b3a3fd23026e8f15a9d130448016a3e1274c1dc) (Block `#60,731,772`)

### 2. Run Automated Tests Locally (16 Unit Tests)
```bash
npm install
npm test          # 16/16 Vitest tests: integer-cent allocation, cash-floor carryover cap, stale/missing reference fail-closed, prepared-quote TOCTOU guard, 9-bucket CeFi quantization, rebalancer, P-256 signing & tamper refusal, stateless share tokens
npm run typecheck # strict TypeScript check (tsc --noEmit)
```

---

## Local Setup & Deployment

```bash
npm install
cp .env.example .env.local
```

Configure one of the following in `.env.local` using your True Markets Organization API Key (downloaded from the True Markets dashboard):
- **Local development:** set `TM_KEY_FILE=/path/to/org-api-key.json`
- **Cloud deployment (e.g., Vercel pinned to a non-US/UK region such as `fra1` or `ams`):** set `TM_ORG_KEY_JSON` to the inline JSON string (or base64 JSON)
- **Optional:** `TM_API_BASE=https://api.truemarkets.co` and `TM_QUOTE_USER_ID=<gateway_user_id>` for zero-login preview quote lookups.

Start the app locally:
```bash
npm run dev       # http://localhost:3000
```

---

## Production Hardening

- **Exact integer-cent splitting:** largest-remainder cent allocation guarantees stock slices plus retained cash sum to the exact penny with zero rounding overflow.
- **Carryover respects your cash floor:** dust carryover below minimum order size rolls to the next payday and is capped so total protected cash never dips below your rent floor.
- **Fail-closed on missing or stale prices:** if a benchmark price is missing or older than 180s, both the compiler/rebalancer and the browser signer refuse execution (`MISSING_REFERENCE_PRICE` / `STALE_REFERENCE_PRICE`) and hold USDC.
- **Closes the preview-to-signing window:** `verifyPreparedOrderQuote()` re-checks the fresh quote from `POST /v1/gateway/orders` against your cap immediately before browser P-256 signing, aborting with zero signature sent if the price jumped.
- **Tamper-resistant local signing:** browser independently verifies the canonical SHA-256 `plan_hash`, cash floor, price limit, and reference freshness against local rules before stamping.
- **Serverless resilience & showcase protection:** receipts and paylinks encode stateless compressed `?d=` share tokens so links survive cold starts, realized receipts report actual executed VWAP spread (`actual fill`), and the funded mainnet demo wallet is write-locked (`403 READ_ONLY_DEMO_WALLET`) while newly created user wallets execute normally.

---

## Built During the Challenge

Allot was built from scratch for True Markets: Call for Builders (first commit Nov 22, 2026). All application code in this repository is new work. Pre-existing components are third-party open-source dependencies only (Next.js, React, Tailwind CSS, Turnkey's `@turnkey/api-key-stamper` and `@turnkey/crypto` for P-256 request stamping, Zod, Vitest and the rest of `package.json`).

---

## Ecosystem Give-Back: True Markets Gateway Field Notes

See **[GATEWAY-NOTES.md](GATEWAY-NOTES.md)** for five verified production engineering notes from building on live True Markets Gateway (9-bucket CeFi increment schedule, `economic_asset_id` DeFi-to-CeFi CLOB pairing, permissionless DeFi vs `403 kyc_required` CeFi boundary, pre-sign prepared-quote checks, and EU `fra1` deployment).

## Evidence & Data Mode Labels

- **Preview** (*Live True Markets Quotes · Preview Mode* / *Preview · no money moved* / `LIVE_QUOTES_PREVIEW`): live True Markets catalog, live Market Data prices, live `POST /v1/gateway/quotes`, and real browser ECDSA P-256 signing; zero funds move until a wallet is funded.
- **Real trade** (*Live Non-Custodial Wallet* / *Real trade · verified on-chain* / `LIVE_GATEWAY`): real `POST /v1/gateway/orders` + browser P-256 `/execute` on a funded True Markets Gateway wallet.
