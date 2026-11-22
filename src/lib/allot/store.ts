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
        signerFingerprint: "028f4a91…e93b12c4",
        defaultInvoiceUsd: 3500,
        rule: DEFAULT_RULE,
        createdAt: "2026-11-22T08:04:00Z",
      },
    },
    receipts: {},
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
        receipts: { ...(parsed.receipts || {}) },
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
