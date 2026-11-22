"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, Copy, RefreshCw, ShieldCheck } from "lucide-react";
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
    return <div className="p-8 text-sm text-stone-500">Loading USDC Paylink…</div>;
  }

  if (!profile) {
    return (
      <div className="rounded-2xl border border-[#E5E4DE] bg-white p-8">
        <h1 className="text-lg font-semibold text-slate-900">Paylink not found</h1>
        <p className="mt-1 text-sm text-stone-600">
          Create your own non-custodial True Markets Gateway wallet in Payday Studio to claim{" "}
          <code className="font-mono">/pay/{handle}</code>.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
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
          className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Payday Studio
        </Link>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-800">
          True Markets Non-Custodial Deposit Wallet
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E5E4DE] bg-white shadow-xs">
        <div className="border-b border-[#E5E4DE] bg-[#F7F6F2]/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allot-logo.svg" alt="Allot" className="mb-3 h-7 w-auto" />
              <div className="font-mono text-xs uppercase tracking-wider text-stone-500">
                USDC Invoice &amp; Paycheck Link · /pay/{profile.handle}
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">{profile.displayName}</h1>
              <p className="text-sm text-stone-600">{profile.roleTitle}</p>
            </div>
            <div className="rounded-xl border border-[#E5E4DE] bg-white px-4 py-2.5 text-right">
              <div className="text-[11px] font-medium uppercase text-stone-500">
                Requested Invoice
              </div>
              <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
                ${profile.defaultInvoiceUsd.toLocaleString()} USDC
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-12">
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] p-5 md:col-span-5">
            <div className="rounded-xl bg-white p-3 shadow-xs">
              <QRCodeSVG value={activeAddress || "0x0"} size={168} level="M" />
            </div>
            <div className="mt-3 flex gap-1.5">
              <button
                onClick={() => setNetwork("evm")}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                  network === "evm"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-stone-700 ring-1 ring-[#E5E4DE]"
                }`}
              >
                Base / EVM USDC
              </button>
              <button
                onClick={() => setNetwork("solana")}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                  network === "solana"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-stone-700 ring-1 ring-[#E5E4DE]"
                }`}
              >
                Solana USDC
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-between space-y-4 md:col-span-7">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Send USDC ({network === "evm" ? "Base / EVM" : "Solana"}) directly to
              </label>
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] p-3">
                <code className="break-all font-mono text-xs text-slate-900">{activeAddress}</code>
                <button
                  onClick={copyAddress}
                  className="shrink-0 rounded-lg border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-stone-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Zero custody risk: wallet keys live inside True Markets&apos; Turnkey TEE and require
                the recipient&apos;s P-256 signer (<code className="font-mono">{profile.signerFingerprint}</code>).
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                  <ShieldCheck className="h-4 w-4" />
                  Live Gateway Balance Watcher
                </div>
                <button
                  onClick={() => refreshBalance(profile.userId)}
                  disabled={checking}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-50"
                >
                  <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
                  Check Now
                </button>
              </div>
              <div className="mt-2 font-mono text-lg font-semibold text-emerald-950 tabular-nums">
                {usdcBalance !== null ? `$${usdcBalance.toFixed(2)} USDC` : "Checking…"}
              </div>
              <div className="mt-1 text-[11px] text-emerald-900/75">
                Upon receipt, Allot protects ${(profile.rule.cashFloorCents / 100).toLocaleString()}{" "}
                in USDC and splits surplus into{" "}
                {profile.rule.legs.map((l) => `${l.symbol} (${l.weightPct}%)`).join(" · ")} with a{" "}
                {profile.rule.maxDriftBps} bps drift cap.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
