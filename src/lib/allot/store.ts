import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PaycheckRule, PaydayReceipt } from "./types";

export interface PaylinkProfile {
  handle: string;
  displayName: string;
  roleTitle: string;
  userId: string;
  solanaAddress: string;
  evmAddress: string;
  signerFingerprint: string;
  defaultInvoiceUsd: number;
  rule: PaycheckRule;
  createdAt: string;
}

interface PersistedState {
  paylinks: Record<string, PaylinkProfile>;
  receipts: Record<string, PaydayReceipt>;
  carryovers: Record<string, Record<string, number>>; // userId -> economicAssetId -> cents
}

const DATA_DIR = join(process.cwd(), ".data");
const DATA_FILE = join(DATA_DIR, "allot-store.json");

export const DEFAULT_PROBE_USER_ID =
  process.env.TM_QUOTE_USER_ID || "98f6006a-b96a-4b77-a9e8-69c1c85c308c";

export const DEFAULT_RULE: PaycheckRule = {
  ruleId: "rule-global-401k-v1",
  label: "Global Remote 401(k)",
  cashFloorCents: 100_000, // $1,000.00 rent & bills floor
  maxDriftBps: 25, // 25 bps max allowed spread above live market price
  minNotionalCents: 200, // $2.00 minimum per leg
  autoStageClobLimit: true,
  legs: [
    {
      economicAssetId: "3ee17c6c-9940-452d-b7b4-a3b086f6da94",
      symbol: "AAPLC",
      name: "Apple",
      weightPct: 35,
    },
    {
      economicAssetId: "b58e6ba0-ecb9-492b-86c6-4aeba2b201fb",
      symbol: "NVDAC",
      name: "NVIDIA",
      weightPct: 30,
    },
    {
      economicAssetId: "952e41f3-320f-43c3-8ead-ad69c8d4e7a6",
      symbol: "SPCXC",
      name: "SpaceX",
      weightPct: 20,
    },
    {
      economicAssetId: "28d38d8c-0a95-4df0-81c9-9438f951f33c", // updated dynamically from catalog if needed
      symbol: "TSLAC",
      name: "Tesla",
      weightPct: 15,
    },
  ],
};

const VERIFIED_LIVE_RECEIPT: PaydayReceipt = {
  receiptId: "rcpt_live_base_20261122",
  createdAt: "2026-11-22T08:38:50.133Z",
  mode: "LIVE_GATEWAY",
  userHandle: "demo-engineer",
  userId: DEFAULT_PROBE_USER_ID,
  signerPublicKey: "03ed4fdb53b5bd570baa5a74d0d237222964e82ceee8f90ae258909ef5e605da6b",
  planHash: "7de2cb7606440cc1c348853952cd572a90c6fc9e7773920e468e59b60ca25588",
  signerProof: {
    verifiedLocalPlanHash: true,
    stampPreview: "eyJwdWJsaWNLZXkiOiIwM2…M2FiMTkzMyJ9",
    scheme: "SIGNATURE_SCHEME_TK_API_P256",
  },
  plan: {
    planVersion: "allot.plan.v1",
    depositEventId: "base-usdc-live-20261122",
    compiledAt: "2026-11-22T08:38:46.829Z",
    mode: "LIVE_GATEWAY",
    incomingCents: 598,
    existingCashCents: 0,
    totalCashBeforeCents: 598,
    cashFloorCents: 209,
    protectedCashCents: 209,
    allocatableSurplusCents: 389,
    cashRetainedByRuleCents: 0,
    planStatus: "READY_TO_SIGN",
    refusalSummary: [],
    legs: [
      {
        economicAssetId: "3ee17c6c-9940-452d-b7b4-a3b086f6da94",
        symbol: "AAPLC",
        name: "Apple",
        icon: "https://api.elbstream.com/logos/symbol/AAPL?format=png&size=128",
        weightPct: 55,
        allocatedCents: 214,
        effectiveCents: 214,
        action: "EXECUTE_DEFI_MARKET",
        reasonCode: "APPROVED",
        reasonMessage:
          "Verified live on-chain Base fill: 0.00612579 AAPLC @ $349.34 VWAP (fee $0.00428, gas sponsored).",
        targetVenue: "defi",
        targetAssetId: "6ed20aa3-e8f2-490a-9626-b97b1e6496f4",
        targetChain: "base",
        orderType: "market",
        qtyUnit: "quote",
        orderQty: "2.14",
        limitPrice: null,
        marketPrice: 348.9177,
        quotePrice: 349.3427,
        quoteFeeUsd: 0.00428,
        driftBps: 12.18,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: 0,
      },
      {
        economicAssetId: "b58e6ba0-ecb9-492b-86c6-4aeba2b201fb",
        symbol: "NVDAC",
        name: "NVIDIA",
        icon: "https://api.elbstream.com/logos/symbol/NVDA?format=png&size=128",
        weightPct: 45,
        allocatedCents: 175,
        effectiveCents: 175,
        action: "EXECUTE_DEFI_MARKET",
        reasonCode: "APPROVED",
        reasonMessage:
          "Verified live on-chain Base fill: 0.01330083 NVDAC @ $131.57 VWAP (fee $0.00350, gas sponsored).",
        targetVenue: "defi",
        targetAssetId: "f1626ca4-3b2d-41b4-9500-745472482db1",
        targetChain: "base",
        orderType: "market",
        qtyUnit: "quote",
        orderQty: "1.75",
        limitPrice: null,
        marketPrice: 131.037,
        quotePrice: 131.5707,
        quoteFeeUsd: 0.0035,
        driftBps: 40.73,
        estimatedSavingsUsd: 0,
        carryoverDeltaCents: 0,
      },
    ],
    totals: {
      executableMarketCents: 389,
      stagedLimitCents: 0,
      carriedOverCents: 0,
      blockedCents: 0,
      estimatedSavingsUsd: 0,
    },
    ruleSnapshot: {
      ...DEFAULT_RULE,
      cashFloorCents: 209,
      maxDriftBps: 50,
    },
    planHash: "7de2cb7606440cc1c348853952cd572a90c6fc9e7773920e468e59b60ca25588",
  },
  executions: [
    {
      symbol: "AAPLC",
      venue: "defi",
      chain: "base",
      orderType: "market",
      orderId: "d700e3f9-60bf-4872-b243-528f0065819d",
      status: "complete",
      requestedUsd: 2.14,
      executedQty: "0.00612579",
      fillPrice: 349.3427,
      benchmarkPrice: 348.9177,
      driftBps: 12.18,
      feeUsd: 0.00428,
      txHash: "0x2c597e239af7072ef5911f1c65d04e4215b018dd464ce29fd3d0b88a05d79b5f",
    },
    {
      symbol: "NVDAC",
      venue: "defi",
      chain: "base",
      orderType: "market",
      orderId: "b7c2f046-f1fd-48cd-8a38-04448d636a2e",
      status: "complete",
      requestedUsd: 1.75,
      executedQty: "0.01330083",
      fillPrice: 131.5707,
      benchmarkPrice: 131.037,
      driftBps: 40.73,
      feeUsd: 0.0035,
      txHash: "0x5239d3f08950dc16a3782b756b3a3fd23026e8f15a9d130448016a3e1274c1dc",
    },
  ],
};

function createInitialState(): PersistedState {
  return {
    paylinks: {
      "demo-engineer": {
        handle: "demo-engineer",
        displayName: "Adaeze Okafor",
        roleTitle: "Staff Product Engineer · Lagos (Paid in USDC)",
        userId: DEFAULT_PROBE_USER_ID,
        solanaAddress: "CEMXtqVJGK5tYvBw9PeVLwTz2dKbkhxQhq31jVVRLVV",
        evmAddress: "0x7DAe0C02233864D8748Ce54e5e658148fC259ac7",
        signerFingerprint: "03ed4fdb…5e605da6b",
        defaultInvoiceUsd: 3500,
        rule: DEFAULT_RULE,
        createdAt: "2026-11-22T08:04:00Z",
      },
    },
    receipts: {
      [VERIFIED_LIVE_RECEIPT.receiptId]: VERIFIED_LIVE_RECEIPT,
    },
    carryovers: {},
  };
}

let memoryState: PersistedState | null = null;

function loadState(): PersistedState {
  if (memoryState) return memoryState;
  try {
    if (existsSync(DATA_FILE)) {
      const parsed = JSON.parse(readFileSync(DATA_FILE, "utf8")) as PersistedState;
      memoryState = {
        ...createInitialState(),
        ...parsed,
        paylinks: { ...createInitialState().paylinks, ...(parsed.paylinks || {}) },
        receipts: { ...createInitialState().receipts, ...(parsed.receipts || {}) },
        carryovers: { ...(parsed.carryovers || {}) },
      };
      return memoryState;
    }
  } catch {
    // ignore read error on read-only serverless fs
  }
  memoryState = createInitialState();
  return memoryState;
}

function saveState(state: PersistedState): void {
  memoryState = state;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch {
    // Vercel serverless fs is read-only; in-memory state still works for the instance lifetime
  }
}

export function getPaylink(handle: string): PaylinkProfile | null {
  const s = loadState();
  return s.paylinks[handle.toLowerCase()] ?? null;
}

export function listPaylinks(): PaylinkProfile[] {
  return Object.values(loadState().paylinks);
}

export function upsertPaylink(profile: PaylinkProfile): PaylinkProfile {
  const s = loadState();
  const key = profile.handle.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  const normalized = { ...profile, handle: key };
  s.paylinks[key] = normalized;
  saveState(s);
  return normalized;
}

export function saveReceipt(receipt: PaydayReceipt): PaydayReceipt {
  const s = loadState();
  s.receipts[receipt.receiptId] = receipt;
  saveState(s);
  return receipt;
}

export function getReceipt(receiptId: string): PaydayReceipt | null {
  return loadState().receipts[receiptId] ?? null;
}

export function listReceipts(): PaydayReceipt[] {
  return Object.values(loadState().receipts).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function getCarryover(userId: string): Record<string, number> {
  return loadState().carryovers[userId] ?? {};
}

export function setCarryover(userId: string, map: Record<string, number>): void {
  const s = loadState();
  s.carryovers[userId] = map;
  saveState(s);
}
