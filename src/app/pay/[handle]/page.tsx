"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, Code2, Copy, RefreshCw, ShieldCheck } from "lucide-react";
import type { PaylinkProfile } from "@/lib/allot/store";

export default function PaylinkPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = use(params);
  const [profile, setProfile] = useState<PaylinkProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState<"evm" | "solana">("evm");
  const [copied, setCopied] = useState(false);
  const [embedTab, setEmbedTab] = useState<"html" | "react">("html");
  const [embedCopied, setEmbedCopied] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const token =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("d")
        : null;
    const qs = token
      ? `handle=${encodeURIComponent(handle)}&d=${encodeURIComponent(token)}`
      : `handle=${encodeURIComponent(handle)}`;
    fetch(`/api/paylinks?${qs}`)
      .then((r) => r.json())
      .then((d) => setProfile(d.paylink ?? null))
      .finally(() => setLoading(false));
  }, [handle]);

  async function refreshBalance(userId: string) {
    setChecking(true);
    try {
      const res = await fetch(`/api/wallet?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (res.ok) setUsdcBalance(data.totalUsdcAvailable ?? 0);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (profile?.userId) refreshBalance(profile.userId);
  }, [profile?.userId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="skeleton h-96 w-full rounded-3xl" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-line bg-surface p-8">
        <h1 className="font-serif-display text-xl font-semibold text-ink">
          Paylink not found
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Create your own non-custodial True Markets Gateway wallet in Payday Studio to claim{" "}
          <code className="font-mono">/pay/{handle}</code>.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2 text-sm font-medium text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Payday Studio
        </Link>
      </div>
    );
  }

  const activeAddress = network === "evm" ? profile.evmAddress : profile.solanaAddress;

  function copyAddress() {
    navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-brand-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Payday Studio
        </Link>
        <span className="rounded-full border border-brand-border bg-brand-soft px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-ink">
          Non-Custodial True Markets Paylink
        </span>
      </div>

      {/* Bespoke Freelancer Invoice Card */}
      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        <div className="border-b border-dashed border-line-strong bg-paper p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allot-logo.svg" alt="Allot" className="mb-4 h-7 w-auto" />
              <div className="font-mono text-xs uppercase tracking-wider text-ink-muted">
                USDC Invoice Request · /pay/{profile.handle}
              </div>
              <h1 className="font-serif-display mt-1 text-2xl font-semibold text-ink sm:text-3xl">
                {profile.displayName}
              </h1>
              <p className="text-sm text-ink-muted">{profile.roleTitle}</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-right">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                Invoice Amount
              </div>
              <div className="font-serif-display mt-0.5 text-3xl font-semibold text-brand-ink tabular-nums">
                ${profile.defaultInvoiceUsd.toLocaleString()}
              </div>
              <div className="font-mono text-xs text-ink-muted">USDC · T+0 Settlement</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-7 md:grid-cols-12">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-paper p-5 md:col-span-5">
            <div className="rounded-2xl border border-line bg-white p-3.5 shadow-xs">
              <QRCodeSVG value={activeAddress || "0x0"} size={168} level="M" fgColor="#171412" />
            </div>
            <div className="mt-4 flex gap-1.5 rounded-full border border-line bg-surface p-1">
              <button
                type="button"
                aria-pressed={network === "evm"}
                onClick={() => setNetwork("evm")}
                className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                  network === "evm" ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                Base USDC
              </button>
              <button
                type="button"
                aria-pressed={network === "solana"}
                onClick={() => setNetwork("solana")}
                className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                  network === "solana"
                    ? "bg-brand text-white"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Solana USDC
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-between space-y-4 md:col-span-7">
            <div>
              <div
                id="paylink-address-label"
                className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                Send USDC ({network === "evm" ? "Base Network" : "Solana Network"}) directly to
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-line bg-paper p-3.5">
                <code aria-labelledby="paylink-address-label" className="break-all font-mono text-xs text-ink">
                  {activeAddress}
                </code>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 py-2 text-xs font-medium text-ink transition hover:border-brand-ink/40"
                >
                  {copied ? (
                    <Check aria-hidden className="h-4 w-4 text-teal-700 dark:text-teal-300" />
                  ) : (
                    <Copy aria-hidden className="h-4 w-4" />
                  )}
                  <span role="status">{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                No network fees for the sender. Money goes straight to the recipient&apos;s own
                wallet. Allot never holds it.
              </p>
            </div>

            <div className="rounded-2xl border border-brand-border bg-brand-soft/70 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-brand-ink">
                  <ShieldCheck className="h-4 w-4" />
                  Current balance
                </div>
                <button
                  type="button"
                  onClick={() => refreshBalance(profile.userId)}
                  disabled={checking}
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-brand-ink ring-1 ring-brand-border hover:bg-paper"
                >
                  <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
                  Check
                </button>
              </div>
              <div className="font-serif-display mt-2 text-2xl font-semibold text-ink tabular-nums">
                {usdcBalance !== null ? `$${usdcBalance.toFixed(2)} USDC` : "Checking…"}
              </div>
              <div className="mt-1 text-xs text-ink-muted">
                On arrival, Allot retains ${(profile.rule.cashFloorCents / 100).toLocaleString()}{" "}
                for rent/bills and routes surplus into{" "}
                {profile.rule.legs.map((l) => `${l.name} (${l.weightPct}%)`).join(", ")}.
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Embeddable Paylink Snippet — Bring U.S. Stocks Everywhere */}
      <div className="rounded-3xl border border-line bg-surface p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink">
              <Code2 className="h-4 w-4" />
              Embed Allot on Any Invoice, Payroll App, or DAO Treasury
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Drop a single button into your invoice or contractor portal so payouts route directly
              into non-custodial U.S. stocks on True Markets Gateway.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border border-line bg-paper p-1">
            {(["html", "react"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setEmbedTab(t)}
                className={`rounded-full px-3 py-1 font-mono text-xs font-medium uppercase ${
                  embedTab === t ? "bg-brand text-white" : "text-ink-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {(() => {
          const linkUrl = `https://allot-ashen.vercel.app/pay/${profile.handle}`;
          const snippet =
            embedTab === "html"
              ? `<a href="${linkUrl}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:8px;background:#701735;color:#fff;padding:10px 18px;border-radius:999px;font-family:sans-serif;font-size:14px;font-weight:600;text-decoration:none;">Pay ${profile.displayName} in USDC → U.S. Stocks (Allot)</a>`
              : `<AllotPayButton handle="${profile.handle}" amountUsd={${profile.defaultInvoiceUsd}} href="${linkUrl}" />`;
          return (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-line bg-paper p-3.5">
              <pre className="overflow-x-auto font-mono text-xs text-ink">{snippet}</pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(snippet);
                  setEmbedCopied(true);
                  setTimeout(() => setEmbedCopied(false), 1500);
                }}
                className="shrink-0 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-brand-ink/40"
              >
                {embedCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
