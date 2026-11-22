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
      setStatusMsg(`Updated limit order ${orderId.slice(0, 10)}… to $${nextPrice}`);
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
          <h1 className="font-serif-display text-3xl font-semibold text-ink">
            Holdings &amp; Orders
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            What you own, how it&apos;s doing, your open limit orders, and cash you can withdraw any
            time.
          </p>
        </div>
        <button
          type="button"
          onClick={loadWallet}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium text-ink transition hover:border-brand-ink/40"
        >
          <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {!wallet && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-border bg-brand-soft px-4 py-3 text-xs text-brand-ink">
          <span className="flex items-center gap-2 font-medium">
            <Shield aria-hidden className="h-4 w-4 shrink-0" />
            You&apos;re viewing a real demo wallet in read-only mode. Create your own wallet on
            Payday Studio to trade.
          </span>
        </div>
      )}

      {/* Live Portfolio Summary Strip */}
      {data?.portfolio && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Total Portfolio
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-ink tabular-nums">
                ${Number(data.portfolio.total_usd || 0).toFixed(2)}
              </div>
              {data.portfolio.change_24h_pct && (
                <div
                  className={`mt-0.5 font-mono text-xs ${
                    Number(data.portfolio.change_24h_pct) >= 0 ? "text-teal-700 dark:text-teal-300" : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  {Number(data.portfolio.change_24h_pct) >= 0 ? "+" : ""}
                  {Number(data.portfolio.change_24h_pct).toFixed(2)}% (24h)
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                U.S. Stocks
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-brand-ink tabular-nums">
                $
                {Math.max(
                  0,
                  Number(data.portfolio.total_usd || 0) - Number(data.portfolio.cash_usd || 0),
                ).toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">Current value</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Cash (USDC)
              </div>
              <div className="font-serif-display mt-1 text-2xl font-semibold text-teal-900 dark:text-teal-200 tabular-nums">
                ${Number(data.portfolio.cash_usd || data.totalUsdcAvailable || 0).toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">Available to spend</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Gain / Loss
              </div>
              <div
                className={`font-serif-display mt-1 text-2xl font-semibold tabular-nums ${
                  Number(data.portfolio.unrealized_pnl_usd || 0) >= 0
                    ? "text-teal-800 dark:text-teal-300"
                    : "text-ink-muted"
                }`}
              >
                {Number(data.portfolio.unrealized_pnl_usd || 0) >= 0 ? "+" : ""}$
                {Number(data.portfolio.unrealized_pnl_usd || 0).toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">If you sold today</div>
            </div>
          </div>

          {/* Visual Portfolio Split Bar */}
          {Number(data.portfolio.total_usd || 0) > 0 && data.portfolio.balances?.length ? (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
              <div aria-hidden className="flex h-2.5 w-full overflow-hidden rounded-full bg-track">
                {data.portfolio.balances.map((pb, idx) => {
                  const pct =
                    (Number(pb.value || 0) / Number(data.portfolio!.total_usd || 1)) * 100;
                  const cls =
                    pb.symbol === "USDC"
                      ? "bg-teal-700"
                      : idx % 2 === 0
                        ? "bg-brand"
                        : "bg-ink";
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
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
                {data.portfolio.balances.map((pb, idx) => {
                  const pct =
                    (Number(pb.value || 0) / Number(data.portfolio!.total_usd || 1)) * 100;
                  const dot =
                    pb.symbol === "USDC"
                      ? "bg-teal-700"
                      : idx % 2 === 0
                        ? "bg-brand"
                        : "bg-ink";
                  return (
                    <span key={pb.asset_id} className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      <span className="font-medium text-ink">{pb.name}</span>
                      <span className="font-mono text-xs">{pct.toFixed(1)}%</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {statusMsg && (
        <div role="status" className="rounded-2xl border border-brand-border bg-brand-soft px-4 py-3 text-xs text-brand-ink">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Balances & Orders */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="font-serif-display text-lg font-semibold text-ink">
                Balances
              </h2>
              <span className="font-mono text-xs text-ink-muted">
                user: {data?.userId.slice(0, 12) ?? "…"}…
              </span>
            </div>

            {loading ? (
              <div className="mt-4 space-y-2.5">
                <div className="skeleton h-14 rounded-xl" />
                <div className="skeleton h-14 rounded-xl" />
              </div>
            ) : !data?.balances.length ? (
              <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-paper p-5 text-center text-xs text-ink-muted">
                Wallet currently holds $0.00. Send a few USDC on Base or Solana to your Paylink
                deposit address to run live fills and test instant Cash Floor withdrawals.
              </div>
            ) : (
              <div className="mt-4 divide-y divide-line">
                {data.balances.map((b, i) => {
                  const pItem = data.portfolio?.balances?.find(
                    (pb) => pb.asset_id === b.asset_id || pb.symbol === b.symbol,
                  );
                  const liveValue = pItem?.value
                    ? Number(pItem.value)
                    : b.usd_value
                      ? Number(b.usd_value)
                      : null;
                  const entryPrice = pItem?.cost_basis?.avg_entry_price
                    ? Number(pItem.cost_basis.avg_entry_price)
                    : null;
                  const livePrice = pItem?.price ? Number(pItem.price) : null;
                  const pnl = pItem?.cost_basis?.unrealized_pnl
                    ? Number(pItem.cost_basis.unrealized_pnl)
                    : null;

                  return (
                    <div
                      key={`${b.symbol}-${b.chain}-${i}`}
                      className="flex items-center justify-between gap-3 py-3.5"
                    >
                      <div className="flex items-center gap-3">
                        {pItem?.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={pItem.icon}
                            alt={b.symbol}
                            className="h-9 w-9 rounded-full border border-line bg-surface object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-mono text-xs font-bold text-white">
                            {b.symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-semibold text-ink">
                              {b.symbol}
                            </span>
                            {pItem?.name && (
                              <span className="text-xs text-ink-muted">{pItem.name}</span>
                            )}
                            <span className="rounded-full bg-paper px-2 py-0.5 font-mono text-[11px] text-ink-muted ring-1 ring-line">
                              {b.chain || b.venue || "cefi"}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-ink-muted tabular-nums">
                            {b.available} {b.symbol}
                            {livePrice && b.symbol !== "USDC"
                              ? ` · Live $${livePrice.toFixed(2)}`
                              : ""}
                            {entryPrice ? ` · Avg $${entryPrice.toFixed(2)}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-right font-mono tabular-nums">
                        <div>
                          <div className="text-sm font-semibold text-ink">
                            {liveValue !== null ? `$${liveValue.toFixed(2)}` : b.available}
                          </div>
                          {pnl !== null && b.symbol !== "USDC" && (
                            <div
                              className={`text-xs ${pnl >= 0 ? "text-teal-700 dark:text-teal-300" : "text-ink-muted"}`}
                            >
                              {pnl >= 0 ? "+" : ""}${pnl.toFixed(3)} P&amp;L
                            </div>
                          )}
                        </div>
                        {b.symbol.toUpperCase() !== "USDC" &&
                          b.asset_id &&
                          Number(b.available) > 0 && (
                            <button
                              type="button"
                              onClick={() => handleQuickSellToUsdc(b)}
                              disabled={submitting || !wallet}
                              title={
                                !wallet
                                  ? "Demo wallet is read-only"
                                  : undefined
                              }
                              className="rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-xs font-medium text-ink transition hover:border-brand-ink/40 disabled:opacity-45"
                            >
                              {wallet ? "Sell to USDC" : "Read-only"}
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <h2 className="font-serif-display text-lg font-semibold text-ink">
              Orders
            </h2>

            {!data?.orders.length ? (
              <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-paper p-5 text-center text-xs text-ink-muted">
                No orders yet. Orders appear here after you sign a payday on Payday Studio.
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {data.orders.map((o) => {
                  const id = o.order_id || o.id || "";
                  return (
                    <div
                      key={id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-paper/70 p-4 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-semibold text-ink">
                            {o.asset_symbol || o.symbol || o.asset_id?.slice(0, 8)}
                          </span>
                          <span className="uppercase text-ink-muted">
                            {o.type} {o.side}
                          </span>
                          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                            {o.status}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted">
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
                              className="font-semibold text-brand-ink underline hover:opacity-80"
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
                            inputMode="decimal"
                            aria-label={`New limit price for ${o.asset_symbol || o.symbol || "order"}`}
                            placeholder={o.price || "New $"}
                            value={editPriceMap[id] ?? ""}
                            onChange={(e) =>
                              setEditPriceMap((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                            className="w-20 rounded-xl border border-line bg-surface px-2.5 py-1 font-mono text-xs text-ink outline-none focus:border-brand-ink"
                          />
                          <button
                            type="button"
                            onClick={() => handleModifyOrder(id)}
                            disabled={submitting || !editPriceMap[id]}
                            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:border-brand-ink/40 disabled:opacity-40"
                          >
                            Update price
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(id)}
                            disabled={submitting}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-200 dark:border-rose-800 bg-surface px-3 py-1.5 text-xs font-medium text-rose-800 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          >
                            <XCircle aria-hidden className="h-3.5 w-3.5" />
                            Cancel order
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
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <Send aria-hidden className="h-4 w-4 text-brand-ink" />
              <h2 className="font-serif-display text-lg font-semibold text-ink">
                Withdraw cash
              </h2>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              Your cash is never locked up. Send USDC to any address on the same network, any time.
            </p>

            <form onSubmit={handleWithdraw} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="withdraw-to" className="block text-xs font-medium text-ink-muted">
                  Send to (same network)
                </label>
                <input
                  id="withdraw-to"
                  autoComplete="off"
                  spellCheck={false}
                  value={withdrawTo}
                  onChange={(e) => setWithdrawTo(e.target.value)}
                  placeholder="0x… or Solana address"
                  required
                  className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-xs text-ink outline-none focus:border-brand-ink focus:bg-surface"
                />
              </div>
              <div>
                <label htmlFor="withdraw-amount" className="block text-xs font-medium text-ink-muted">
                  Amount (USDC)
                </label>
                <input
                  id="withdraw-amount"
                  inputMode="decimal"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-sm font-semibold text-ink outline-none focus:border-brand-ink focus:bg-surface"
                />
              </div>

              <div className="rounded-2xl border border-brand-border bg-brand-soft/60 p-3.5 text-xs text-ink-muted">
                <div className="flex items-center gap-1.5 font-semibold text-brand-ink">
                  <Shield aria-hidden className="h-3.5 w-3.5" />
                  Only you can withdraw
                </div>
                <p className="mt-1 leading-relaxed">
                  Withdrawals need a signature from the key in this browser (
                  <span className="font-mono">{vault?.fingerprint ?? "…"}</span>). Allot&apos;s servers
                  can never move your money on their own.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting || !withdrawAssetId || !withdrawTo || !wallet}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-45"
              >
                {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                {submitting ? "Sending…" : wallet ? "Sign & send USDC" : "Demo wallet is read-only"}
                <ArrowUpRight aria-hidden className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
