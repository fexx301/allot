<p align="left">
  <img src="public/allot-logo.svg" alt="Allot — Non-Custodial Global 401(k) in U.S. Stocks" height="52" />
</p>

# Allot — Non-Custodial Global 401(k) in U.S. Stocks

**Live Demo (EU `fra1`):** [https://allot-ashen.vercel.app](https://allot-ashen.vercel.app) · **Verified Mainnet Base Receipt:** [`/receipt/rcpt_live_base_20261122`](https://allot-ashen.vercel.app/receipt/rcpt_live_base_20261122) · **Health:** [`/api/health`](https://allot-ashen.vercel.app/api/health)

> **Route every USDC paycheck into 136 tokenized U.S. stocks on True Markets Gateway — never below your cash floor, never past your reference-price drift band, and never without your browser's P-256 signature.**

Millions of remote engineers, designers, and contractors outside the U.S. already get paid in **USDC**. When a $3,500 invoice lands today, they face two bad options: leave 100% idle in USDC, or eat 3–5% FX off-ramp fees and fight restricted U.S. brokerage onboarding — or worse, click "Buy" on a weekend tokenized stock pool and absorb **+38 to +45 bps** of unanchored after-hours spread.

**Most fintech apps give you a manual buy button. Allot gives you a non-custodial paycheck engine with hard cash-floor protection and cross-venue CLOB drift routing.**

---

## 60-Second Judge Path

1. **Open Payday Studio (`/`)** — zero login required. Immediately loads **136 live tokenized U.S. stocks** from `GET /v1/gateway/assets?asset_class=stock` (including 14 dual-venue CLOB flagships: `AAPLC`, `NVDAC`, `MSFTC`, `AMZNC`, `GOOGLC`, `METAC`, `TSLAC`, `PLTRC`, and pre-IPO **`SPCXC` SpaceX**) plus live Market Data prices and live `POST /v1/gateway/quotes`. The UI speaks plain language (`0.25%`, "Limit order", "Buying now"); click **"Technical details"** on the *Live Payday Execution Plan* card to reveal the raw engine codes, venues, order quantities and `economic_asset_id`s quoted below.
2. **Test the 3 live scenarios (top cards):**
   - **$3,500 Remote Salary** (*Max price above market* = `0.25%`, i.e. 25 bps): each stock card shows "$X to invest · ≈ N shares" with *Market* vs *Your price*. Any stock whose live quote is more than 0.25% above market gets a **"Limit order ≤ $…"** badge: the engine raised **`PRICE_DRIFT_GUARDED`** and switched via True Markets' **`economic_asset_id`** from the DeFi market listing to the paired **`cefi` CLOB `limit` order** (`qty_unit: "base"`, tick-quantized limit price). Stocks inside the limit show **"Buying now"** (`DEFI MARKET`). Estimated savings appear as "Est. $… spread saved".
   - **$850 Freelance Invoice** ($1,000 *Cash to always keep*): triggers **`CASH_FLOOR_PROTECTED`**. The stub shows **"Floor Locked"**, every stock shows **"Held · Cash floor"**, the sticky bar reads *"Below your cash floor. Nothing will be bought."* and 0 orders are placed.
   - **$32 Micro-Payout** (`0.55%` limit): the 4% SpaceX slice ($1.28) shows **"Next payday"** (**`BELOW_MIN_NOTIONAL`** carryover) while the other legs still route.
3. **Try to break the safety checks:** on the *Only you can approve this* card, open **"Demo: try to break the safety checks"**.
   - Tick **"Server tampers with my cash floor"**: Allot simulates a compromised server lowering your cash floor; the browser re-checks the plan against your rule, shows *"Blocked: the plan doesn't match your rules"* (`SIGNER_REQUIRED`) and disables signing. The sticky bar links to the reason.
   - Tick **"Price jumps right before signing"**, then click **"Sign (price-jump test)"**: the prepared quote comes back above your limit, the client-side `verifyPreparedOrderQuote()` gate refuses before any P-256 signature is produced, and a three-step panel shows *Price you saw → Price at order time → Your money is safe*.
4. **Sign & inspect the receipt (`/receipt/[id]`):** untick the demos and click **"Sign & get receipt"** in the sticky bar at the bottom of the screen. Your browser stamps the canonical SHA-256 `plan_hash` with its ECDSA P-256 key (`SIGNATURE_SCHEME_TK_API_P256`) and opens a **Payday Receipt** labelled *"Preview · no money moved"*, with plan digest, signer key, stamp proof and a per-stock table; **"Download receipt (JSON)"** exports it. All receipts are listed at **`/receipts`**.
5. **Rebalancer (`/rebalance`):** pick **"NVIDIA rallied 40%"**. Allot sells the overweight stock first so the USDC funds underweight buys (*Trade plan (sells run before buys)*), marks holdings inside your ±3% range **"On target · skip"**, and routes legs priced above your limit to **"Limit sell" / "Limit buy"** CeFi CLOB orders. **"Use my real holdings"** loads live `AAPLC`/`NVDAC` balances; **"Sign rebalance plan"** stamps it with P-256.
6. **Real wallet, Paylink & Holdings (`/pay/[handle]` & `/orders`):** click **"Create Wallet"** on Payday Studio to call live `POST /v1/account/organizations/{id}/users` with your browser's compressed P-256 public key and get real Solana + Base USDC deposit addresses. Share **`/pay/[handle]`** (QR, **Copy** address, live *Current balance*). On **Holdings** (`/orders`): **"Update price"** (`PATCH`) or **"Cancel order"** on resting CeFi CLOB limit orders, **"Sell to USDC"**, and **"Withdraw cash" → "Sign & send USDC"** via `POST /v1/gateway/transfers`. Without your own wallet, Holdings shows the funded mainnet demo wallet read-only.

> Theme: the top-right button cycles **System / Light / Dark**. The UI is keyboard-accessible (visible focus, labelled controls, Escape closes dialogs).

---

## Load-Bearing True Markets Gateway Architecture

| True Markets Capability | Endpoint | What Breaks Without It |
|---|---|---|
| **Multi-Venue Stock Catalog & `economic_asset_id`** | `GET /v1/gateway/assets?asset_class=stock` | Breaks discovery of 136 tokenized U.S. stocks and automatic `defi` (market-only) → `cefi` (CLOB `limit`) pairing across the same underlying company. |
| **No-Auth Live Market Data** | `GET /v1/defi/market/prices/history` | Breaks real-time benchmark pricing used to compute exact bps spread before every fill. |
| **Live Execution Quotes** | `POST /v1/gateway/quotes` | Breaks live pre-trade quote pricing, fee transparency, and drift-guard comparison. |
| **Programmatic Turnkey Wallets** | `POST /v1/account/organizations/{id}/users` + `TM-On-Behalf-Of` | Breaks instant non-custodial Solana + Base USDC Paylink provisioning with zero seed phrases. |
| **Dual-Key P-256 Order Lifecycle** | `POST /v1/gateway/orders` (`market` & `limit`) + `/execute` + `PATCH` + `/cancel` | Breaks true non-custodial separation: Allot's Org API key can plan and prepare `initialized` orders, but **cannot execute a single cent** without the user's browser P-256 signature. |
| **Balances & Instant Cash Withdrawal** | `GET /v1/gateway/balances`, `POST /v1/gateway/transfers` | Breaks live incoming paycheck detection and instant withdrawal of the protected Cash Floor. |

---

## Local Setup & Verification

```bash
npm install
cp .env.example .env.local
# Point TM_KEY_FILE in .env.local to your downloaded True Markets Org API Key JSON
# (or set TM_ORG_KEY_JSON for cloud deployment in a non-US/UK region such as fra1 / ams)

npm test          # 16 unit tests: integer-cent math, refusals, CLOB routing, rebalancer, P-256 tamper checks
npm run typecheck # strict TypeScript check
npm run dev       # http://localhost:3000
```

## Verified Live Mainnet Base Execution Proof (`2026-11-22 08:38 UTC`)

Executed live on True Markets Gateway (`user_id: 98f6006a-b96a-4b77-a9e8-69c1c85c308c`) from a **$5.98 USDC** Base deposit (`$2.09` Cash Floor preserved in USDC, `$3.89` split across `AAPLC` + `NVDAC`, signed locally with ECDSA P-256 `SIGNATURE_SCHEME_TK_API_P256`, total fees `$0.00778`, zero gas paid):

| Leg | Allocation | Filled Qty | Executed VWAP | Gateway Order ID | BaseScan Settlement Tx |
|---|---|---|---|---|---|
| **AAPLC** (Apple) | $2.14 USDC | `0.00612579` | `$349.3427` | `d700e3f9-60bf-4872-b243-528f0065819d` | [`0x2c597e…5d79b5f`](https://basescan.org/tx/0x2c597e239af7072ef5911f1c65d04e4215b018dd464ce29fd3d0b88a05d79b5f) |
| **NVDAC** (NVIDIA) | $1.75 USDC | `0.01330083` | `$131.5707` | `b7c2f046-f1fd-48cd-8a38-04448d636a2e` | [`0x5239d3…1274c1dc`](https://basescan.org/tx/0x5239d3f08950dc16a3782b756b3a3fd23026e8f15a9d130448016a3e1274c1dc) |
| **Protected Cash Floor** | $2.09 USDC | `2.085321 USDC` | — | Held untouched in user's Base Turnkey wallet | — |

Inspect this statement directly inside the app at `/receipt/rcpt_live_base_20261122`.

## Ecosystem Give-Back: True Markets Gateway Field Notes

See **[GATEWAY-NOTES.md](GATEWAY-NOTES.md)** for our verified production engineering notes (9-bucket CeFi increment schedule, `economic_asset_id` 122 DeFi vs 14 CeFi CLOB limit split, permissionless DeFi vs `403 kyc_required` CeFi boundary, pre-sign prepared-quote TOCTOU guard, and EU `fra1` serverless routing).

## Evidence & Data Mode Labels

True Markets Gateway operates live on-chain with no public sandbox (`docs.truemarkets.co/llms.txt`). Allot labels every screen and receipt explicitly:
- **Preview** (Payday Studio badge *"Live True Markets Quotes · Preview Mode"*; receipts *"Preview · no money moved"*; engine mode `LIVE_QUOTES_PREVIEW`): real live True Markets catalog (`136` stocks), live Market Data prices, live `POST /v1/gateway/quotes`, and real browser ECDSA P-256 signing. Zero funds move until you fund a wallet.
- **Real trade** (Payday Studio badge *"Live Non-Custodial Wallet"* and the **"Invest for real"** button once a wallet is connected; receipts *"Real trade · verified on-chain"*; engine mode `LIVE_GATEWAY`): real `POST /v1/gateway/orders` + browser P-256 `/execute` on a funded True Markets Gateway user wallet.
