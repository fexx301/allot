"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fieldId = useId();

  // Native modal dialog: Escape-to-close, focus trap and inert page behind it come for free
  useEffect(() => {
    const el = dialogRef.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);

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
    <dialog
      ref={dialogRef}
      aria-labelledby={`${fieldId}-title`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line bg-surface p-0 shadow-xl backdrop:bg-slate-950/45 backdrop:backdrop-blur-xs"
    >
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-ink">
              <KeyRound aria-hidden className="h-3 w-3" />
              Your keys, your money
            </div>
            <h2 id={`${fieldId}-title`} className="font-serif-display mt-2 text-xl font-semibold text-ink">
              {connectedWallet ? "Your Wallet" : "Create Your Wallet"}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Your signing key never leaves this browser. Allot only shares its public half with
              True Markets to create your Base and Solana deposit addresses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-stone-100 dark:hover:bg-stone-950/40 hover:text-ink"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-paper p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-muted">Your browser signing key (public)</span>
            <span className="font-mono text-brand-ink">{vault?.fingerprint ?? "Initializing…"}</span>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-ink-muted">
            {vault?.publicKeyCompressedHex}
          </p>
        </div>

        {connectedWallet ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-brand-border bg-brand-soft p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-brand-ink">
                  Active Gateway User: {connectedWallet.displayName}
                </span>
                <span className="font-mono text-xs text-brand-ink">
                  /pay/{connectedWallet.handle}
                </span>
              </div>
              <div className="mt-2 font-mono text-xs text-ink-muted">
                user_id: {connectedWallet.userId}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                    Base / EVM USDC Address
                  </div>
                  <div className="truncate font-mono text-xs text-ink">
                    {connectedWallet.evmAddress}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={copied === "evm" ? "Copied" : "Copy Base address"}
                  onClick={() => copy(connectedWallet.evmAddress, "evm")}
                  className="ml-2 shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                >
                  {copied === "evm" ? (
                    <Check className="h-3.5 w-3.5 text-teal-700 dark:text-teal-300" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                    Solana USDC Address
                  </div>
                  <div className="truncate font-mono text-xs text-ink">
                    {connectedWallet.solanaAddress}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={copied === "sol" ? "Copied" : "Copy Solana address"}
                  onClick={() => copy(connectedWallet.solanaAddress, "sol")}
                  className="ml-2 shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                >
                  {copied === "sol" ? (
                    <Check className="h-3.5 w-3.5 text-teal-700 dark:text-teal-300" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleProvision} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${fieldId}-name`} className="block text-xs font-medium text-ink-muted">
                  Your Name
                </label>
                <input
                  id={`${fieldId}-name`}
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-handle`} className="block text-xs font-medium text-ink-muted">
                  Paylink Handle
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-line bg-paper px-2.5 focus-within:border-ink">
                  <span aria-hidden className="text-xs text-ink-muted">/pay/</span>
                  <input
                    id={`${fieldId}-handle`}
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    required
                    className="w-full bg-transparent py-2 pl-1 text-sm text-ink outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor={`${fieldId}-role`} className="block text-xs font-medium text-ink-muted">
                Role / Invoice Subtitle
              </label>
              <input
                id={`${fieldId}-role`}
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink outline-none focus:border-ink"
              />
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                <Shield aria-hidden className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
                Allot can never move funds without you
              </span>
              <button
                type="submit"
                disabled={loading || !vault}
                className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
              >
                {loading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                {loading ? "Creating…" : "Create Wallet"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
