import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-line bg-surface p-8 text-center shadow-xs">
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-ink">404</p>
      <h1 className="font-serif-display mt-2 text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        The link may be mistyped or out of date.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        <Link
          href="/"
          className="inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Payday Studio
        </Link>
        <Link
          href="/receipts"
          className="inline-flex items-center rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink hover:border-brand-ink/40"
        >
          Receipts
        </Link>
      </div>
    </div>
  );
}
