# Allot — Non-Custodial Global 401(k) in U.S. Stocks

> **Route every USDC paycheck into 136 tokenized U.S. stocks on True Markets Gateway — never below your cash floor, never past your reference-price drift band, and never without your browser's P-256 signature.**

Millions of remote engineers, designers, and contractors outside the U.S. already get paid in **USDC**. When a $3,500 invoice lands today, they face two bad options: leave 100% idle in USDC, or eat 3–5% FX off-ramp fees and fight restricted U.S. brokerage onboarding — or worse, click "Buy" on a weekend tokenized stock pool and absorb **+38 to +45 bps** of unanchored after-hours spread.

**Most fintech apps give you a manual buy button. Allot gives you a non-custodial paycheck engine with hard cash-floor protection and cross-venue CLOB drift routing.**

---

## 60-Second Judge Path

1. **Open Payday Studio (`/`)** — zero login required. Immediately loads **136 live tokenized U.S. stocks** from `GET /v1/gateway/assets?asset_class=stock` (including 14 dual-venue CLOB flagships: `AAPLC`, `NVDAC`, `MSFTC`, `AMZNC`, `GOOGLC`, `METAC`, `TSLAC`, `PLTRC`, and pre-IPO **`SPCXC` SpaceX**) plus live Market Data prices and live `POST /v1/gateway/quotes`.
2. **Test the 3 live scenarios (top cards):**
   - **$3,500 Remote Salary (`25 bps` cap):** Watch live quotes compare against live Market Data prices. Any stock whose spread exceeds 25 bps triggers **`PRICE_DRIFT_GUARDED`** and automatically switches via True Markets' **`economic_asset_id`** from the DeFi market listing to the paired **`cefi` CLOB `limit` order** (`qty_unit: "base"`, tick-quantized limit price) with estimated dollar savings.
   - **$850 Freelance Invoice (`$1,000` rent floor):** Triggers **`CASH_FLOOR_PROTECTED`** — 0 orders placed, 100% kept liquid in USDC.
   - **$32 Micro-Payout (`55 bps` cap):** Triggers **`BELOW_MIN_NOTIONAL`** carryover on the 4% leg ($1.28) while allowing tight-spread legs to route as `DEFI MARKET`.
3. **Test Client-Side P-256 Signer Refusal:** Toggle **"Test Server Tamper Refusal"** — Allot simulates a compromised server lowering your Cash Floor; the browser signer detects the rule violation and refuses to sign (`SIGNER_REQUIRED`).
4. **Sign Locally & Inspect Receipt (`/receipt/[id]`):** Click **"Sign Locally (P-256) & Mint Preview Receipt"** to stamp the canonical SHA-256 `plan_hash` with your browser's ECDSA P-256 key (`SIGNATURE_SCHEME_TK_API_P256`) and inspect the exportable Best-Execution Payday Statement.
5. **Provision a Real Gateway Wallet & Shareable Paylink (`/pay/[handle]` & `/orders`):** Click **"Create Non-Custodial Wallet"** to call live `POST /v1/account/organizations/{id}/users` with your browser's compressed P-256 public key, get real Solana + Base USDC deposit addresses, share `/pay/[handle]`, manage resting CeFi CLOB limit orders, and withdraw protected USDC via `POST /v1/gateway/transfers`.

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

npm test          # 6 unit tests: integer-cent math, refusals, CLOB routing, P-256 tamper checks
npm run typecheck # strict TypeScript check
npm run dev       # http://localhost:3000
```

## Evidence & Data Mode Labels

True Markets Gateway operates live on-chain with no public sandbox (`docs.truemarkets.co/llms.txt`). Allot labels every screen and receipt explicitly:
- **`LIVE QUOTES · PREVIEW MODE`**: Real live True Markets catalog (`136` stocks), live Market Data prices, live `POST /v1/gateway/quotes`, and real browser ECDSA P-256 signing — zero funds moved until you fund a wallet.
- **`LIVE GATEWAY`**: Real `POST /v1/gateway/orders` + browser P-256 `/execute` on a funded True Markets Gateway user wallet.
