"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

const WATCH_SYMBOLS = [
  "AAPLC",
  "NVDAC",
  "SPCXC",
  "TSLAC",
  "MSFTC",
  "AMZNC",
  "GOOGLC",
  "METAC",
  "PLTRC",
];

interface TickerEntry {
  symbol: string;
  price: number;
  change24h?: number;
  refMid?: number;
  updatedAt?: string;
}

export function LiveSpreadTicker() {
  const [ticks, setTicks] = useState<Record<string, TickerEntry>>({});
  const [wsState, setWsState] = useState<"connecting" | "live" | "rest-fallback">("connecting");

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;

    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => {
        if (closed || !d?.pricesByEconomicId) return;
        const seeded: Record<string, TickerEntry> = {};
        for (const val of Object.values(d.pricesByEconomicId) as Array<{
          symbol: string;
          price: number;
          timestamp: string;
        } | null>) {
          if (val && WATCH_SYMBOLS.includes(val.symbol)) {
            seeded[val.symbol] = {
              symbol: val.symbol,
              price: val.price,
              updatedAt: val.timestamp,
            };
          }
        }
        setTicks((prev) => ({ ...seeded, ...prev }));
      })
      .catch(() => {});

    try {
      ws = new WebSocket("wss://api.truemarkets.co/v1/defi/market");
      ws.onopen = () => {
        if (closed || !ws) return;
        setWsState("live");
        const topics = [
          ...WATCH_SYMBOLS.map((s) => `price.${s}`),
          ...WATCH_SYMBOLS.slice(0, 5).map((s) => `reference.${s}`),
        ];
        ws.send(JSON.stringify({ type: "subscribe", topics }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data));
          if (msg.type === "price" && msg.data?.symbol && msg.data?.price) {
            const sym = String(msg.data.symbol).toUpperCase();
            setTicks((prev) => ({
              ...prev,
              [sym]: {
                ...prev[sym],
                symbol: sym,
                price: Number(msg.data.price),
                change24h:
                  msg.data.change_24h !== undefined
                    ? Number(msg.data.change_24h)
                    : prev[sym]?.change24h,
                updatedAt: msg.data.timestamp,
              },
            }));
          } else if (msg.type === "reference" && msg.data?.symbol && msg.data?.mid_price) {
            const sym = String(msg.data.symbol).toUpperCase();
            setTicks((prev) => ({
              ...prev,
              [sym]: {
                ...prev[sym],
                symbol: sym,
                price: prev[sym]?.price ?? Number(msg.data.mid_price),
                refMid: Number(msg.data.mid_price),
                updatedAt: msg.data.timestamp,
              },
            }));
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!closed) setWsState("rest-fallback");
      };
      ws.onclose = () => {
        if (!closed) setWsState("rest-fallback");
      };
    } catch {
      setWsState("rest-fallback");
    }

    return () => {
      closed = true;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  const items = WATCH_SYMBOLS.map((s) => ticks[s]).filter(Boolean);

  return (
    <div className="border-b border-[#E5E1D8] bg-[#FAF8F4]">
      <div className="mx-auto flex max-w-7xl items-center gap-3.5 overflow-x-auto px-4 py-2 text-xs sm:px-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-[#E5E1D8] pr-3.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[#701735]">
          <Radio
            className={`h-3 w-3 ${
              wsState === "live"
                ? "text-[#701735] animate-pulse"
                : wsState === "connecting"
                  ? "text-amber-600"
                  : "text-stone-400"
            }`}
          />
          {wsState === "live"
            ? "24/7 Live Feed"
            : wsState === "connecting"
              ? "Syncing Feed…"
              : "Live Market"}
        </div>

        <div className="flex items-center gap-5">
          {items.length === 0 ? (
            <div className="flex items-center gap-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="skeleton h-4 w-24 rounded-md" />
              ))}
            </div>
          ) : (
            items.map((t) => (
              <div
                key={t.symbol}
                className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums"
              >
                <span className="font-semibold text-[#171412]">{t.symbol}</span>
                <span className="text-[#625B54]">${t.price.toFixed(2)}</span>
                {t.change24h !== undefined && Number.isFinite(t.change24h) && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      t.change24h >= 0
                        ? "bg-teal-50 text-teal-800"
                        : "bg-rose-50 text-rose-800"
                    }`}
                  >
                    {t.change24h >= 0 ? "+" : ""}
                    {t.change24h.toFixed(2)}%
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
