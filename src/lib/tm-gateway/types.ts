export type GatewayVenue = "cefi" | "defi";
export type GatewayOrderType = "market" | "limit";
export type GatewayOrderSide = "buy" | "sell";
export type GatewayQtyUnit = "base" | "quote";

export interface GatewayAsset {
  id: string;
  economic_asset_id: string | null;
  chain: string | null;
  address: string | null;
  symbol: string;
  name: string;
  decimals: number;
  slug: string;
  is_active: boolean;
  status: string;
  description: string;
  website: string;
  icon: string;
  tradeable: boolean;
  stable: boolean;
  venue: GatewayVenue;
  type: "spot" | "perp" | string;
  asset_class: "stock" | "crypto" | string;
  issuer: string | null;
  image?: {
    thumb?: string;
    small?: string;
    large?: string;
  };
  order_types: GatewayOrderType[];
}

export interface PairedStockAsset {
  economicAssetId: string;
  symbol: string;
  name: string;
  issuer: string | null;
  icon: string;
  defiListing: GatewayAsset | null;
  cefiListing: GatewayAsset | null;
  supportsClobLimit: boolean;
  chains: string[];
  venues: GatewayVenue[];
}

export interface GatewayWallet {
  address: string;
  chain_family: "solana" | "evm" | string;
}

export interface GatewayUser {
  user_id: string;
  external_ref_id: string;
  created_at: string;
  wallets: GatewayWallet[];
}

export interface GatewayBalance {
  asset_id?: string;
  symbol: string;
  chain: string | null;
  venue?: string;
  available: string;
  locked?: string;
  total?: string;
  usd_value?: string;
}

export interface GatewayQuoteRequest {
  asset_id?: string;
  base_asset?: string;
  quote_asset?: string;
  qty: string;
  qty_unit: GatewayQtyUnit;
  side: GatewayOrderSide;
}

export interface GatewayQuoteResponse {
  qty: string;
  price: string;
  notional: string;
  fee: string;
  venues?: Array<{ venue: string; share?: string; price?: string }>;
  issues?: Array<{ code?: string; message?: string }>;
}

export interface GatewayOrderPayload {
  payload: string;
  type?: string;
}

export interface GatewayCreateOrderRequest {
  asset_id: string;
  venue?: GatewayVenue | "smart";
  qty: string;
  qty_unit: GatewayQtyUnit;
  side: GatewayOrderSide;
  type: GatewayOrderType;
  price?: string;
}

export interface GatewayOrderResponse {
  order_id?: string;
  id?: string;
  status: string;
  asset_id?: string;
  symbol?: string;
  side?: GatewayOrderSide;
  type?: GatewayOrderType;
  qty?: string;
  executed_qty?: string;
  price?: string;
  avg_fill_price?: string;
  executed_vwap?: string;
  fee?: string;
  tx_hash?: string;
  quote?: GatewayQuoteResponse;
  payloads?: GatewayOrderPayload[];
  created_at?: string;
  updated_at?: string;
}

export interface GatewayTransferRequest {
  asset_id: string;
  qty: string;
  qty_unit: "base";
  to: string;
}

export interface GatewayTransferResponse {
  transfer_id?: string;
  id?: string;
  status: string;
  payloads?: GatewayOrderPayload[];
}

export interface MarketPricePoint {
  t: string;
  price: string;
}

export interface MarketPriceHistory {
  asset_id: string;
  symbol: string;
  window: string;
  resolution: string;
  points: MarketPricePoint[];
}

export interface GatewayApiErrorBody {
  type?: string;
  code?: string;
  message?: string;
  request_id?: string;
}
