"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-xl rounded-3xl border border-line bg-surface p-8 text-center shadow-xs">
      <AlertTriangle aria-hidden className="mx-auto h-8 w-8 text-amber-700 dark:text-amber-300" />
      <h1 className="font-serif-display mt-3 text-2xl font-semibold text-ink">
        Something went wrong
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Nothing was signed and no money moved. Try again, or head back to Payday Studio.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-ink-muted">Reference: {error.digest}</p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-hover"
        >
          <RefreshCw aria-hidden className="h-4 w-4" />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink hover:border-brand-ink/40"
        >
          Payday Studio
        </Link>
      </div>
    </div>
  );
}
