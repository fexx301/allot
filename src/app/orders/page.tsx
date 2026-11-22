"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Loader2, RefreshCw, Send, Shield, XCircle } from "lucide-react";
import { loadOrCreateBrowserVault, stampGatewayPayload, type LocalP256SignerVault } from "@/lib/allot/signer";
import type { ConnectedGatewayWallet } from "@/components/WalletModal";
import type { GatewayBalance, GatewayOrderResponse } from "@/lib/tm-gateway/types";

interface PortfolioBalanceItem {
  asset_id: string;
  symbol: string;
  name: string;
  chain: string | null;
  venue: string;
  icon?: string;
  available: string;
  total: string;
  price?: string;
  value?: string;
  change_24h_pct?: string;
  cost_basis?: {
    avg_entry_price?: string;
    cost_usd?: string;
    unrealized_pnl?: string;
  };
}

interface PortfolioSummary {
  total_usd?: string;
  cash_usd?: string;
  change_24h_usd?: string;
  change_24h_pct?: string;
  unrealized_pnl_usd?: string;
  balances?: PortfolioBalanceItem[];
}

interface WalletApiResponse {
  userId: string;
  fetchedAt: string;
  totalUsdcAvailable: number;
  balances: GatewayBalance[];
  orders: Array<
    GatewayOrderResponse & {
      asset_symbol?: string;
      explorer_url?: string;
      executed_vwap?: string;
      fee?: string;
    }
  >;
  portfolio?: PortfolioSummary | null;
  carryoverCents: Record<string, number>;
}

export default function OrdersAndWalletPage() {
  const [vault, setVault] = useState<LocalP256SignerVault | null>(null);
  const [wallet, setWallet] = useState<ConnectedGatewayWallet | null>(null);
  const [data, setData] = useState<WalletApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Cash floor withdrawal & inline limit-edit state
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("1.00");
  const [withdrawAssetId, setWithdrawAssetId] = useState("");
  const [editPriceMap, setEditPriceMap] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      setVault(loadOrCreateBrowserVault());
      const saved = window.localStorage.getItem("allot.connected.wallet.v1");
      if (saved) setWallet(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  const loadWallet = useCallback(async () => {
    setLoading(true);
    try {
      const qs = wallet?.userId ? `?userId=${encodeURIComponent(wallet.userId)}` : "";
      const res = await fetch(`/api/wallet${qs}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
        const usdc = (json.balances as GatewayBalance[]).find(
          (b) => b.symbol.toUpperCase() === "USDC" && b.asset_id,
        );
        if (usdc?.asset_id && !withdrawAssetId) setWithdrawAssetId(usdc.asset_id);
      }
    } finally {
      setLoading(false);
    }
  }, [wallet?.userId, withdrawAssetId]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  async function handleModifyOrder(orderId: string) {
    if (!data) return;
    const nextPrice = editPriceMap[orderId]?.trim();
    if (!nextPrice) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/orders/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "modify",
          userId: data.userId,
          orderId,
          price: nextPrice,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Modify failed");
      setStatusMsg(`Updated CLOB limit order ${orderId.slice(0, 10)}… to $${nextPrice}`);
      await loadWallet();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Modify failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickSellToUsdc(bal: GatewayBalance) {
    if (!vault || !data || !bal.asset_id) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const prepRes = await fetch("/api/orders/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: data.userId,
          orders: [
            {
              symbol: bal.symbol,
              venue: bal.venue === "cefi" ? "cefi" : "defi",
              asset_id: bal.asset_id,
              qty: bal.available,
              qty_unit: "base",
              side: "sell",
              type: "market",
            },
          ],
        }),
      });
      const prep = await prepRes.json();
      const first = prep.prepared?.[0];
      if (!prepRes.ok || !first?.ok || !first.orderId) {
        throw new Error(first?.error || prep.error || "Sell preparation failed");
      }

      const payloads: Array<{ payload: string }> = first.payloads ?? [];
      const signatures = await Promise.all(
        payloads.map((p) => stampGatewayPayload(vault, p.payload)),
      );

      const execRes = await fetch("/api/orders/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "LIVE_GATEWAY",
          userId: data.userId,
          userHandle: wallet?.handle || "wallet",
          signerPublicKey: vault.publicKeyCompressedHex,
          planStamp: signatures[0] || "sell",
          plan: {
            planVersion: "allot.plan.v1",
            depositEventId: `sell-${Date.now()}`,
            compiledAt: new Date().toISOString(),
            mode: "LIVE_GATEWAY",
            incomingCents: 0,
            existingCashCents: 0,
            totalCashBeforeCents: 0,
            cashFloorCents: 0,
            protectedCashCents: 0,
            allocatableSurplusCents: 0,
            cashRetainedByRuleCents: 0,
            planStatus: "READY_TO_SIGN",
            refusalSummary: [],
            legs: [],
            totals: {
              executableMarketCents: 0,
              stagedLimitCents: 0,
              carriedOverCents: 0,
              blockedCents: 0,
              estimatedSavingsUsd: 0,
            },
            ruleSnapshot: {
              ruleId: "quick-sell",
              label: "Sell to USDC",
              cashFloorCents: 0,
              maxDriftBps: 100,
              minNotionalCents: 100,
              autoStageClobLimit: false,
              legs: [],
            },
            planHash: `sell-${first.orderId}`,
          },
          signedOrders: [
            {
              symbol: bal.symbol,
              venue: bal.venue === "cefi" ? "cefi" : "defi",
              orderType: "market",
              orderId: first.orderId,
              requestedUsd: Number(bal.usd_value || 0),
              signatures,
            },
          ],
        }),
      });
      if (!execRes.ok) throw new Error("Sell execution failed");
      setStatusMsg(`Sold ${bal.available} ${bal.symbol} back to USDC (order ${first.orderId})`);
      await loadWallet();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Sell failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    if (!vault || !data) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const prepRes = await fetch("/api/orders/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare_cancel",
          userId: data.userId,
          orderId,
        }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error || "Prepare cancel failed");

      const payloads: Array<{ payload: string }> = prep.order?.payloads ?? [];
      const signatures = await Promise.all(
        payloads.map((p) => stampGatewayPayload(vault, p.payload)),
      );

      const execRes = await fetch("/api/orders/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "execute_cancel",
          userId: data.userId,
          orderId,
          signatures,
        }),
      });
      const exec = await execRes.json();
      if (!execRes.ok) throw new Error(exec.error || "Cancel execute failed");
      setStatusMsg(`Order ${orderId} canceled (status: ${exec.order?.status})`);
      await loadWallet();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!vault || !data || !withdrawAssetId) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const prepRes = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          userId: data.userId,
          asset_id: withdrawAssetId,
          qty: withdrawAmount,
          to: withdrawTo.trim(),
        }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error || "Prepare transfer failed");

      const payloads: Array<{ payload: string }> = prep.transfer?.payloads ?? [];
      const signatures = await Promise.all(
        payloads.map((p) => stampGatewayPayload(vault, p.payload)),
      );

      const execRes = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          userId: data.userId,
          transferId: prep.transfer.transfer_id || prep.transfer.id,
          signatures,
        }),
      });
      const exec = await execRes.json();
      if (!execRes.ok) throw new Error(exec.error || "Transfer execute failed");
      setStatusMsg(`Withdrawal submitted (status: ${exec.transfer?.status})`);
      await loadWallet();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif-display text-3xl font-semibold text-[#171412]">
            Portfolio Holdings &amp; CLOB Orders
          </h1>
          <p className="mt-1 text-sm text-[#625B54]">
            Live True Markets Gateway portfolio value, tokenized U.S. stock cost basis &amp; P&amp;L,
            resting CeFi limit orders, and instant Cash Floor USDC transfers.
          </p>
        </div>
        <button
          onClick={loadWallet}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E1D8] bg-white px-4 py-2 text-xs font-medium text-[#171412] transition hover:border-[#701735]/40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Sync Gateway State
        </button>
      </div>

      {!wallet && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#EAD2DA] bg-[#F9EFF2] px-4 py-3 text-xs text-[#701735]">
          <span className="flex items-center gap-2 font-medium">
            <Shield className="h-4 w-4 shrink-0" />
            Viewing live mainnet Base showcase wallet (read-only · P-256 signer key stays offline).
          </span>
          <span className="font-mono text-[11px]">403 READ_ONLY_DEMO_WALLET enforced</span>
        </div>
      )}

      {/* Live Portfolio Summary Strip */}
      {data?.portfolio && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Total Portfolio
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-[#171412] tabular-nums">
                ${Number(data.portfolio.total_usd || 0).toFixed(2)}
              </div>
              {data.portfolio.change_24h_pct && (
                <div
                  className={`mt-0.5 font-mono text-xs ${
                    Number(data.portfolio.change_24h_pct) >= 0 ? "text-teal-700" : "text-rose-700"
                  }`}
                >
                  {Number(data.portfolio.change_24h_pct) >= 0 ? "+" : ""}
                  {Number(data.portfolio.change_24h_pct).toFixed(2)}% (24h)
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Tokenized U.S. Stocks
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-[#701735] tabular-nums">
                $
                {Math.max(
                  0,
                  Number(data.portfolio.total_usd || 0) - Number(data.portfolio.cash_usd || 0),
                ).toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#625B54]">Live Base holdings</div>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Protected Cash Floor
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-teal-900 tabular-nums">
                ${Number(data.portfolio.cash_usd || data.totalUsdcAvailable || 0).toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#625B54]">Spendable USDC</div>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Unrealized P&amp;L
              </div>
              <div
                className={`font-serif-display mt-1 text-2xl font-semibold tabular-nums ${
                  Number(data.portfolio.unrealized_pnl_usd || 0) >= 0
                    ? "text-teal-800"
                    : "text-[#625B54]"
                }`}
              >
                {Number(data.portfolio.unrealized_pnl_usd || 0) >= 0 ? "+" : ""}$
                {Number(data.portfolio.unrealized_pnl_usd || 0).toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#625B54]">Live mark-to-market</div>
            </div>
          </div>

          {/* Visual Portfolio Split Bar */}
          {Number(data.portfolio.total_usd || 0) > 0 && data.portfolio.balances?.length ? (
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4 shadow-xs">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#ECE8DF]">
                {data.portfolio.balances.map((pb, idx) => {
                  const pct =
                    (Number(pb.value || 0) / Number(data.portfolio!.total_usd || 1)) * 100;
                  const cls =
                    pb.symbol === "USDC"
                      ? "bg-teal-700"
                      : idx % 2 === 0
                        ? "bg-[#701735]"
                        : "bg-[#171412]";
                  return (
                    <div
                      key={pb.asset_id}
                      style={{ width: `${Math.max(1, pct)}%` }}
                      className={cls}
                      title={`${pb.symbol}: ${pct.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#625B54]">
                {data.portfolio.balances.map((pb, idx) => {
                  const pct =
                    (Number(pb.value || 0) / Number(data.portfolio!.total_usd || 1)) * 100;
                  const dot =
                    pb.symbol === "USDC"
                      ? "bg-teal-700"
                      : idx % 2 === 0
                        ? "bg-[#701735]"
                        : "bg-[#171412]";
                  return (
                    <span key={pb.asset_id} className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      <span className="font-medium text-[#171412]">{pb.name}</span>
                      <span className="font-mono text-[11px]">{pct.toFixed(1)}%</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {statusMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Balances & Orders */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
                Live Gateway Balances
              </h2>
              <span className="font-mono text-xs text-stone-500">
                user: {data?.userId.slice(0, 12) ?? "…"}…
              </span>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-stone-500">Loading live balances…</div>
            ) : !data?.balances.length ? (
              <div className="mt-4 rounded-xl border border-dashed border-[#E5E4DE] bg-[#F7F6F2] p-5 text-center text-xs text-stone-600">
                Wallet currently holds $0.00. Send a few USDC on Base or Solana to your Paylink
                deposit address to run live fills and test instant Cash Floor withdrawals.
              </div>
            ) : (
              <div className="mt-4 divide-y divide-[#E5E4DE]">
                {data.balances.map((b, i) => {
                  const pItem = data.portfolio?.balances?.find(
                    (pb) => pb.asset_id === b.asset_id || pb.symbol === b.symbol,
                  );
                  const liveValue = pItem?.value ? Number(pItem.value) : b.usd_value ? Number(b.usd_value) : null;
                  const entryPrice = pItem?.cost_basis?.avg_entry_price
                    ? Number(pItem.cost_basis.avg_entry_price)
                    : null;
                  const livePrice = pItem?.price ? Number(pItem.price) : null;
                  const pnl = pItem?.cost_basis?.unrealized_pnl
                    ? Number(pItem.cost_basis.unrealized_pnl)
                    : null;

                  return (
                    <div key={`${b.symbol}-${b.chain}-${i}`} className="flex items-center justify-between gap-3 py-3.5">
                      <div className="flex items-center gap-3">
                        {pItem?.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={pItem.icon}
                            alt={b.symbol}
                            className="h-8 w-8 rounded-full border border-[#E5E4DE] bg-white object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 font-mono text-xs font-bold text-white">
                            {b.symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-semibold text-slate-900">{b.symbol}</span>
                            {pItem?.name && <span className="text-xs text-stone-500">{pItem.name}</span>}
                            <span className="rounded bg-[#F7F6F2] px-1.5 py-0.5 font-mono text-[10px] text-stone-600">
                              {b.chain || b.venue || "cefi"}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-stone-500 tabular-nums">
                            {b.available} {b.symbol}
                            {livePrice && b.symbol !== "USDC" ? ` · Live $${livePrice.toFixed(2)}` : ""}
                            {entryPrice ? ` · Avg Entry $${entryPrice.toFixed(2)}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-right font-mono tabular-nums">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {liveValue !== null ? `$${liveValue.toFixed(2)}` : b.available}
                          </div>
                          {pnl !== null && b.symbol !== "USDC" && (
                            <div
                              className={`text-[11px] ${pnl >= 0 ? "text-emerald-700" : "text-stone-500"}`}
                            >
                              {pnl >= 0 ? "+" : ""}${pnl.toFixed(3)} P&amp;L
                            </div>
                          )}
                        </div>
                        {b.symbol.toUpperCase() !== "USDC" && b.asset_id && Number(b.available) > 0 && (
                          <button
                            onClick={() => handleQuickSellToUsdc(b)}
                            disabled={submitting || !wallet}
                            title={!wallet ? "Showcase wallet is read-only (signer key offline)" : undefined}
                            className="rounded-lg border border-[#E5E4DE] bg-[#F7F6F2] px-2.5 py-1.5 font-sans text-xs font-medium text-slate-800 hover:bg-stone-200/70 disabled:opacity-40"
                          >
                            {wallet ? "Sell to USDC" : "Locked (Demo)"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
              Gateway Orders (Market &amp; Resting CeFi CLOB Limit)
            </h2>

            {!data?.orders.length ? (
              <div className="mt-4 rounded-xl border border-dashed border-[#E5E4DE] bg-[#F7F6F2] p-5 text-center text-xs text-stone-600">
                No executed or resting orders yet for this Gateway user.
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {data.orders.map((o) => {
                  const id = o.order_id || o.id || "";
                  return (
                    <div
                      key={id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2]/50 p-3.5 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-semibold text-slate-900">
                            {o.asset_symbol || o.symbol || o.asset_id?.slice(0, 8)}
                          </span>
                          <span className="uppercase text-stone-600">{o.type} {o.side}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-[#E5E4DE]">
                            {o.status}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-stone-500">
                          <span>
                            {o.executed_qty || o.qty} sh
                            {o.executed_vwap
                              ? ` @ $${Number(o.executed_vwap).toFixed(2)}`
                              : o.price
                                ? ` @ $${o.price}`
                                : ""}
                          </span>
                          <span>· id={id.slice(0, 12)}…</span>
                          {o.explorer_url && (
                            <a
                              href={o.explorer_url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-emerald-700 underline hover:text-emerald-900"
                            >
                              BaseScan ↗
                            </a>
                          )}
                        </div>
                      </div>
                      {o.status === "active" && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="text"
                            placeholder={o.price || "New $"}
                            value={editPriceMap[id] ?? ""}
                            onChange={(e) =>
                              setEditPriceMap((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                            className="w-20 rounded-lg border border-[#E5E4DE] bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none focus:border-slate-900"
                          />
                          <button
                            onClick={() => handleModifyOrder(id)}
                            disabled={submitting || !editPriceMap[id]}
                            className="rounded-lg border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-stone-100 disabled:opacity-40"
                          >
                            PATCH Price
                          </button>
                          <button
                            onClick={() => handleCancelOrder(id)}
                            disabled={submitting}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Sign &amp; Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Instant Cash Floor Withdrawal */}
        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-[#E5E4DE] bg-white p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-emerald-700" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
                Withdraw Protected Cash Floor
              </h2>
            </div>
            <p className="mt-1.5 text-xs text-stone-600">
              Your protected rent/cash USDC is never locked up. Send tokens out anytime via{" "}
              <code className="font-mono">POST /v1/gateway/transfers</code> signed locally by your
              browser P-256 key.
            </p>

            <form onSubmit={handleWithdraw} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-700">
                  Destination Address (same chain)
                </label>
                <input
                  value={withdrawTo}
                  onChange={(e) => setWithdrawTo(e.target.value)}
                  placeholder="0x… or Solana address"
                  required
                  className="mt-1 w-full rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-slate-900 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700">Amount (USDC)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-3 py-2 font-mono text-sm font-semibold text-slate-900 outline-none focus:border-slate-900 focus:bg-white"
                />
              </div>

              <div className="rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] p-3 text-[11px] text-stone-600">
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Shield className="h-3.5 w-3.5 text-emerald-700" />
                  Non-custodial withdrawal guarantee
                </div>
                <p className="mt-1">
                  Even if Allot shuts down, you can always withdraw funds or sell tokenized stocks
                  back to USDC because only your P-256 key ({vault?.fingerprint ?? "…"}) authorizes
                  transfers.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting || !withdrawAssetId || !withdrawTo || !wallet}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-40"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {wallet ? "Sign with P-256 & Send USDC" : "Read-Only Showcase Wallet (Signer Offline)"}
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
