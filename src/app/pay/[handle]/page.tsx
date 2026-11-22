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
    return (
      <div className="mx-auto max-w-3xl">
        <div className="skeleton h-96 w-full rounded-3xl" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-[#E5E1D8] bg-white p-8">
        <h1 className="font-serif-display text-xl font-semibold text-[#171412]">
          Paylink not found
        </h1>
        <p className="mt-1 text-sm text-[#625B54]">
          Create your own non-custodial True Markets Gateway wallet in Payday Studio to claim{" "}
          <code className="font-mono">/pay/{handle}</code>.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#701735] px-5 py-2 text-sm font-medium text-white"
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
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#625B54] hover:text-[#701735]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Payday Studio
        </Link>
        <span className="rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#701735]">
          Non-Custodial True Markets Paylink
        </span>
      </div>

      {/* Bespoke Freelancer Invoice Card */}
      <div className="overflow-hidden rounded-3xl border border-[#E5E1D8] bg-white shadow-sm">
        <div className="h-2 w-full bg-[#701735]" />
        <div className="border-b border-dashed border-[#D8D1C5] bg-[#FAF8F4] p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allot-logo.svg" alt="Allot" className="mb-4 h-7 w-auto" />
              <div className="font-mono text-[11px] uppercase tracking-wider text-[#625B54]">
                USDC Invoice Request · /pay/{profile.handle}
              </div>
              <h1 className="font-serif-display mt-1 text-2xl font-semibold text-[#171412] sm:text-3xl">
                {profile.displayName}
              </h1>
              <p className="text-sm text-[#625B54]">{profile.roleTitle}</p>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-white px-5 py-3.5 text-right">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#625B54]">
                Invoice Amount
              </div>
              <div className="font-serif-display mt-0.5 text-3xl font-semibold text-[#701735] tabular-nums">
                ${profile.defaultInvoiceUsd.toLocaleString()}
              </div>
              <div className="font-mono text-[11px] text-[#625B54]">USDC · T+0 Settlement</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-7 md:grid-cols-12">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#E5E1D8] bg-[#FAF8F4] p-5 md:col-span-5">
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-3.5 shadow-xs">
              <QRCodeSVG value={activeAddress || "0x0"} size={168} level="M" fgColor="#171412" />
            </div>
            <div className="mt-4 flex gap-1.5 rounded-full border border-[#E5E1D8] bg-white p-1">
              <button
                onClick={() => setNetwork("evm")}
                className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                  network === "evm" ? "bg-[#701735] text-white" : "text-[#625B54] hover:text-[#171412]"
                }`}
              >
                Base USDC
              </button>
              <button
                onClick={() => setNetwork("solana")}
                className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                  network === "solana"
                    ? "bg-[#701735] text-white"
                    : "text-[#625B54] hover:text-[#171412]"
                }`}
              >
                Solana USDC
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-between space-y-4 md:col-span-7">
            <div>
              <label className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#625B54]">
                Send USDC ({network === "evm" ? "Base Network" : "Solana Network"}) directly to
              </label>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-[#E5E1D8] bg-[#FAF8F4] p-3.5">
                <code className="break-all font-mono text-xs text-[#171412]">{activeAddress}</code>
                <button
                  onClick={copyAddress}
                  className="shrink-0 rounded-xl border border-[#E5E1D8] bg-white p-2 text-[#171412] transition hover:border-[#701735]/40"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-teal-700" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-[#625B54]">
                Gas is sponsored by True Markets. Funds land directly in the recipient&apos;s
                non-custodial Turnkey wallet (<code className="font-mono">{profile.signerFingerprint}</code>).
              </p>
            </div>

            <div className="rounded-2xl border border-[#EAD2DA] bg-[#F9EFF2]/70 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#701735]">
                  <ShieldCheck className="h-4 w-4" />
                  Live Gateway Balance Watcher
                </div>
                <button
                  onClick={() => refreshBalance(profile.userId)}
                  disabled={checking}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#701735] ring-1 ring-[#EAD2DA] hover:bg-[#FAF8F4]"
                >
                  <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
                  Check
                </button>
              </div>
              <div className="font-serif-display mt-2 text-2xl font-semibold text-[#171412] tabular-nums">
                {usdcBalance !== null ? `$${usdcBalance.toFixed(2)} USDC` : "Checking…"}
              </div>
              <div className="mt-1 text-xs text-[#625B54]">
                On arrival, Allot retains ${(profile.rule.cashFloorCents / 100).toLocaleString()}{" "}
                for rent/bills and routes surplus into{" "}
                {profile.rule.legs.map((l) => `${l.name} (${l.weightPct}%)`).join(", ")}.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
