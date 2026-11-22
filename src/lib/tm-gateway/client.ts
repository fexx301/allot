import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  GatewayApiErrorBody,
  GatewayAsset,
  GatewayBalance,
  GatewayCreateOrderRequest,
  GatewayOrderResponse,
  GatewayQuoteRequest,
  GatewayQuoteResponse,
  GatewayTransferRequest,
  GatewayTransferResponse,
  GatewayUser,
  MarketPriceHistory,
  PairedStockAsset,
} from "./types";

export class TrueMarketsApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly type?: string;
  readonly requestId?: string;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    const parsed = (body && typeof body === "object" ? body : {}) as GatewayApiErrorBody;
    super(message || parsed.message || `True Markets API error (${status})`);
    this.name = "TrueMarketsApiError";
    this.status = status;
    this.code = parsed.code;
    this.type = parsed.type;
    this.requestId = parsed.request_id;
    this.body = body;
  }
}

interface OrgKeyMaterial {
  key_id: string;
  private_key: JsonWebKey;
}

interface CachedToken {
  accessToken: string;
  organizationId: string;
  expiresAtMs: number;
}

interface CachedCatalog {
  assets: GatewayAsset[];
  paired: PairedStockAsset[];
  fetchedAtMs: number;
}

const DEFAULT_BASE = "https://api.truemarkets.co";
const CATALOG_TTL_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 90 * 1000;

export function pairStockAssetsByEconomicId(assets: GatewayAsset[]): PairedStockAsset[] {
  const byKey = new Map<string, GatewayAsset[]>();
  for (const a of assets) {
    if (!a.is_active || !a.tradeable) continue;
    const key = a.economic_asset_id || a.id;
    const bucket = byKey.get(key) ?? [];
    bucket.push(a);
    byKey.set(key, bucket);
  }

  const paired: PairedStockAsset[] = [];
  for (const [economicAssetId, list] of byKey.entries()) {
    const cefiListing = list.find((a) => a.venue === "cefi") ?? null;
    const defiListing =
      list.find((a) => a.venue === "defi" && a.chain === "base") ??
      list.find((a) => a.venue === "defi") ??
      null;
    const primary = cefiListing ?? defiListing ?? list[0];
    const supportsClobLimit = Boolean(cefiListing?.order_types?.includes("limit"));
    const chains = Array.from(
      new Set(list.map((a) => a.chain).filter((c): c is string => Boolean(c))),
    );
    const venues = Array.from(new Set(list.map((a) => a.venue)));

    paired.push({
      economicAssetId,
      symbol: primary.symbol,
      name: primary.name,
      issuer: primary.issuer,
      icon: primary.image?.small || primary.icon || "",
      defiListing,
      cefiListing,
      supportsClobLimit,
      chains,
      venues,
    });
  }

  // Flagship dual-venue CLOB-limit stocks first, then alphabetical
  paired.sort((a, b) => {
    if (a.supportsClobLimit !== b.supportsClobLimit) {
      return a.supportsClobLimit ? -1 : 1;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  return paired;
}

export class TrueMarketsGatewayClient {
  private readonly baseUrl: string;
  private readonly keyLoader: () => OrgKeyMaterial;
  private cachedToken: CachedToken | null = null;
  private cachedCatalog: CachedCatalog | null = null;

  constructor(options?: { baseUrl?: string; orgKey?: OrgKeyMaterial; keyFile?: string }) {
    this.baseUrl = (options?.baseUrl || process.env.TM_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
    this.keyLoader = () => {
      if (options?.orgKey) return options.orgKey;
      const inline = process.env.TM_ORG_KEY_JSON;
      if (inline) {
        const trimmed = inline.trim();
        const raw = trimmed.startsWith("{")
          ? trimmed
          : Buffer.from(trimmed, "base64").toString("utf8");
        return JSON.parse(raw) as OrgKeyMaterial;
      }
      const path = options?.keyFile || process.env.TM_KEY_FILE;
      if (!path) {
        throw new Error("Missing True Markets Org API Key (set TM_KEY_FILE or TM_ORG_KEY_JSON)");
      }
      return JSON.parse(readFileSync(path, "utf8")) as OrgKeyMaterial;
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      throw new TrueMarketsApiError(res.status, parsed);
    }

    return parsed as T;
  }

  async getOrgAuth(): Promise<{ accessToken: string; organizationId: string; expiresAt: string }> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > now) {
      return {
        accessToken: this.cachedToken.accessToken,
        organizationId: this.cachedToken.organizationId,
        expiresAt: new Date(this.cachedToken.expiresAtMs).toISOString(),
      };
    }

    const { key_id, private_key } = this.keyLoader();
    const timestamp = Math.floor(now / 1000);
    const signature = sign("sha256", Buffer.from(`${key_id}.${timestamp}`), {
      key: createPrivateKey({ key: private_key as unknown as import("node:crypto").JsonWebKey, format: "jwk" }),
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");

    const minted = await this.request<{
      access_token: string;
      token_type: string;
      expires_in: string;
    }>("POST", "/v1/auth/api-key/token", {
      key_id,
      timestamp,
      signature,
    });

    const claims = JSON.parse(
      Buffer.from(minted.access_token.split(".")[1], "base64url").toString("utf8"),
    ) as { tm?: { organization_id?: string }; exp?: number };

    const organizationId = claims.tm?.organization_id;
    if (!organizationId) {
      throw new Error("Minted True Markets token did not contain tm.organization_id claim");
    }

    const expiresAtMs = minted.expires_in
      ? Date.parse(minted.expires_in)
      : (claims.exp ?? Math.floor(now / 1000) + 3600) * 1000;

    this.cachedToken = {
      accessToken: minted.access_token,
      organizationId,
      expiresAtMs,
    };

    return {
      accessToken: minted.access_token,
      organizationId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  private async userHeaders(userId: string): Promise<Record<string, string>> {
    const { accessToken } = await this.getOrgAuth();
    return {
      Authorization: `Bearer ${accessToken}`,
      "TM-On-Behalf-Of": userId,
    };
  }

  // --- Public No-Auth Catalog & Market Data ---

  async getStockCatalog(forceRefresh = false): Promise<{
    assets: GatewayAsset[];
    paired: PairedStockAsset[];
    fetchedAt: string;
  }> {
    const now = Date.now();
    if (!forceRefresh && this.cachedCatalog && now - this.cachedCatalog.fetchedAtMs < CATALOG_TTL_MS) {
      return {
        assets: this.cachedCatalog.assets,
        paired: this.cachedCatalog.paired,
        fetchedAt: new Date(this.cachedCatalog.fetchedAtMs).toISOString(),
      };
    }

    const res = await this.request<{ data: GatewayAsset[] }>(
      "GET",
      "/v1/gateway/assets?asset_class=stock",
    );
    const assets = res.data ?? [];
    const paired = pairStockAssetsByEconomicId(assets);
    this.cachedCatalog = { assets, paired, fetchedAtMs: now };

    return { assets, paired, fetchedAt: new Date(now).toISOString() };
  }

  async getCryptoAssets(): Promise<GatewayAsset[]> {
    const res = await this.request<{ data: GatewayAsset[] }>(
      "GET",
      "/v1/gateway/assets?asset_class=crypto",
    );
    return res.data ?? [];
  }

  async getLatestMarketPrice(symbol: string): Promise<{
    symbol: string;
    price: number;
    timestamp: string;
    points: Array<{ t: string; price: number }>;
  } | null> {
    try {
      const history = await this.request<MarketPriceHistory>(
        "GET",
        `/v1/defi/market/prices/history?symbol=${encodeURIComponent(symbol)}&window=1h`,
      );
      const pts = (history.points ?? [])
        .map((p) => ({ t: p.t, price: Number(p.price) }))
        .filter((p) => Number.isFinite(p.price) && p.price > 0);
      if (pts.length === 0) return null;
      const latest = pts[pts.length - 1];
      return {
        symbol: history.symbol,
        price: latest.price,
        timestamp: latest.t,
        points: pts.slice(-24),
      };
    } catch {
      return null;
    }
  }

  // --- Authenticated Organization & User Management ---

  async createOrGetUser(externalRefId: string, signerPublicKey: string): Promise<GatewayUser> {
    const { accessToken, organizationId } = await this.getOrgAuth();
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const user = await this.request<GatewayUser>(
          "POST",
          `/v1/account/organizations/${organizationId}/users`,
          {
            external_ref_id: externalRefId,
            signer_public_key: signerPublicKey,
          },
          { Authorization: `Bearer ${accessToken}` },
        );
        if (user.wallets && user.wallets.length > 0) return user;
      } catch (err) {
        lastErr = err;
        if (!(err instanceof TrueMarketsApiError) || err.status !== 503 || attempt === 5) {
          throw err;
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw lastErr ?? new Error("Gateway user wallets did not become ready");
  }

  // --- Quotes, Balances, Orders & Transfers ---

  async getBalances(userId: string): Promise<GatewayBalance[]> {
    const headers = await this.userHeaders(userId);
    const res = await this.request<{ data: GatewayBalance[] }>(
      "GET",
      "/v1/gateway/balances",
      undefined,
      headers,
    );
    return res.data ?? [];
  }

  async getPortfolio(userId: string): Promise<unknown> {
    const headers = await this.userHeaders(userId);
    return this.request<unknown>("GET", "/v1/gateway/portfolio", undefined, headers);
  }

  async getQuote(userId: string, req: GatewayQuoteRequest): Promise<GatewayQuoteResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayQuoteResponse>("POST", "/v1/gateway/quotes", req, headers);
  }

  async createOrder(userId: string, req: GatewayCreateOrderRequest): Promise<GatewayOrderResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayOrderResponse>("POST", "/v1/gateway/orders", req, headers);
  }

  async executeOrder(
    userId: string,
    orderId: string,
    signatures: string[],
  ): Promise<GatewayOrderResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayOrderResponse>(
      "POST",
      `/v1/gateway/orders/${encodeURIComponent(orderId)}/execute`,
      { signatures, auth_type: "api_key" },
      headers,
    );
  }

  async getOrder(userId: string, orderId: string): Promise<GatewayOrderResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayOrderResponse>(
      "GET",
      `/v1/gateway/orders/${encodeURIComponent(orderId)}`,
      undefined,
      headers,
    );
  }

  async listOrders(userId: string, status?: string): Promise<GatewayOrderResponse[]> {
    const headers = await this.userHeaders(userId);
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await this.request<{ data: GatewayOrderResponse[] }>(
      "GET",
      `/v1/gateway/orders${qs}`,
      undefined,
      headers,
    );
    return res.data ?? [];
  }

  async modifyOrder(
    userId: string,
    orderId: string,
    patch: { price?: string; qty?: string },
  ): Promise<GatewayOrderResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayOrderResponse>(
      "PATCH",
      `/v1/gateway/orders/${encodeURIComponent(orderId)}`,
      patch,
      headers,
    );
  }

  async prepareCancelOrder(userId: string, orderId: string): Promise<GatewayOrderResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayOrderResponse>(
      "POST",
      `/v1/gateway/orders/${encodeURIComponent(orderId)}/cancel`,
      {},
      headers,
    );
  }

  async executeCancelOrder(
    userId: string,
    orderId: string,
    signatures: string[],
  ): Promise<GatewayOrderResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayOrderResponse>(
      "POST",
      `/v1/gateway/orders/${encodeURIComponent(orderId)}/cancel/execute`,
      { signatures, auth_type: "api_key" },
      headers,
    );
  }

  async createTransfer(
    userId: string,
    req: GatewayTransferRequest,
  ): Promise<GatewayTransferResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayTransferResponse>("POST", "/v1/gateway/transfers", req, headers);
  }

  async executeTransfer(
    userId: string,
    transferId: string,
    signatures: string[],
  ): Promise<GatewayTransferResponse> {
    const headers = await this.userHeaders(userId);
    return this.request<GatewayTransferResponse>(
      "POST",
      `/v1/gateway/transfers/${encodeURIComponent(transferId)}/execute`,
      { signatures, auth_type: "api_key" },
      headers,
    );
  }

  async getOrgTransactions(type?: "order" | "transfer"): Promise<unknown[]> {
    const { accessToken, organizationId } = await this.getOrgAuth();
    const qs = type ? `?type=${type}` : "";
    const res = await this.request<{ data: unknown[] }>(
      "GET",
      `/v1/gateway/organizations/${organizationId}/transactions${qs}`,
      undefined,
      { Authorization: `Bearer ${accessToken}` },
    );
    return res.data ?? [];
  }
}

let singleton: TrueMarketsGatewayClient | null = null;
export function getGatewayClient(): TrueMarketsGatewayClient {
  if (!singleton) {
    singleton = new TrueMarketsGatewayClient();
  }
  return singleton;
}
