"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, Shield, X } from "lucide-react";
import type { LocalP256SignerVault } from "@/lib/allot/signer";

export interface ConnectedGatewayWallet {
  userId: string;
  handle: string;
  displayName: string;
  solanaAddress: string;
  evmAddress: string;
  signerPublicKey: string;
  signerFingerprint: string;
  sharePath?: string;
}

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
  vault: LocalP256SignerVault | null;
  connectedWallet: ConnectedGatewayWallet | null;
  onConnected: (wallet: ConnectedGatewayWallet) => void;
}

export function WalletModal({
  open,
  onClose,
  vault,
  connectedWallet,
  onConnected,
}: WalletModalProps) {
  const [displayName, setDisplayName] = useState("Femi Ogunsanya");
  const [handle, setHandle] = useState("femi-usdc");
  const [roleTitle, setRoleTitle] = useState("Software Engineer · Paid in USDC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (!open) return null;

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    if (!vault) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          displayName,
          roleTitle,
          signerPublicKey: vault.publicKeyCompressedHex,
          defaultInvoiceUsd: 2500,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to provision True Markets Gateway user");
      }
      const next: ConnectedGatewayWallet = {
        userId: data.user.user_id,
        handle: data.paylink.handle,
        displayName: data.paylink.displayName,
        solanaAddress: data.paylink.solanaAddress,
        evmAddress: data.paylink.evmAddress,
        signerPublicKey: vault.publicKeyCompressedHex,
        signerFingerprint: vault.fingerprint,
        sharePath: data.sharePath,
      };
      window.localStorage.setItem("allot.connected.wallet.v1", JSON.stringify(next));
      onConnected(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provisioning failed");
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-[#E5E4DE] bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-2.5 py-0.5 text-xs font-medium text-[#701735]">
              <KeyRound className="h-3 w-3" />
              Non-Custodial Turnkey TEE + P-256
            </div>
            <h2 className="font-serif-display mt-2 text-xl font-semibold text-[#171412]">
              {connectedWallet ? "Your True Markets Gateway Wallet" : "Create Non-Custodial Wallet"}
            </h2>
            <p className="mt-1 text-xs text-stone-600">
              Your ECDSA P-256 private key stays strictly in this browser. Only the compressed public
              key is sent to True Markets Gateway to create your Solana &amp; Base deposit wallets.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-stone-600">Browser P-256 Signer Public Key</span>
            <span className="font-mono text-emerald-700">{vault?.fingerprint ?? "Initializing…"}</span>
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-stone-500">
            {vault?.publicKeyCompressedHex}
          </p>
        </div>

        {connectedWallet ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-emerald-900">
                  Active Gateway User: {connectedWallet.displayName}
                </span>
                <span className="font-mono text-[11px] text-emerald-700">
                  /pay/{connectedWallet.handle}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-stone-600">
                user_id: {connectedWallet.userId}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-[#E5E4DE] p-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                    Base / EVM USDC Address
                  </div>
                  <div className="truncate font-mono text-xs text-slate-900">
                    {connectedWallet.evmAddress}
                  </div>
                </div>
                <button
                  onClick={() => copy(connectedWallet.evmAddress, "evm")}
                  className="ml-2 shrink-0 rounded-lg border border-[#E5E4DE] px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  {copied === "evm" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[#E5E4DE] p-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                    Solana USDC Address
                  </div>
                  <div className="truncate font-mono text-xs text-slate-900">
                    {connectedWallet.solanaAddress}
                  </div>
                </div>
                <button
                  onClick={() => copy(connectedWallet.solanaAddress, "sol")}
                  className="ml-2 shrink-0 rounded-lg border border-[#E5E4DE] px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  {copied === "sol" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleProvision} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-stone-700">Your Name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[#E5E4DE] px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700">Paylink Handle</label>
                <div className="mt-1 flex items-center rounded-xl border border-[#E5E4DE] bg-[#F7F6F2] px-2.5">
                  <span className="text-xs text-stone-500">/pay/</span>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    required
                    className="w-full bg-transparent py-2 pl-1 text-sm text-slate-900 outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700">Role / Invoice Subtitle</label>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#E5E4DE] px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="flex items-center gap-1 text-[11px] text-stone-500">
                <Shield className="h-3.5 w-3.5 text-emerald-700" />
                Calls live POST /v1/account/organizations/…/users
              </span>
              <button
                type="submit"
                disabled={loading || !vault}
                className="inline-flex items-center gap-2 rounded-full bg-[#701735] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#581028] disabled:opacity-50"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Gateway Wallet
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
