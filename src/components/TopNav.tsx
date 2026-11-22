"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LiveSpreadTicker } from "./LiveSpreadTicker";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { ArrowUpRight, FileCheck2, Landmark, Layers, Link2, Scale } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Payday Studio", icon: Layers },
  { href: "/rebalance", label: "Rebalancer", icon: Scale },
  { href: "/pay/femi", label: "USDC Paylink", icon: Link2 },
  { href: "/orders", label: "Holdings", icon: Landmark },
  { href: "/receipts", label: "Receipts", icon: FileCheck2 },
];

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href === "/pay/femi" ? "/pay" : href);
}

export function TopNav() {
  const pathname = usePathname();
  const mobileActiveRef = useRef<HTMLAnchorElement>(null);

  // Keep the current tab visible in the horizontally-scrolling mobile nav
  useEffect(() => {
    mobileActiveRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-7">
          <Link href="/" className="group flex items-center gap-2.5">
            <Logo
              label="Allot — Global 401(k) on True Markets"
              className="h-8 transition duration-200 group-hover:scale-[1.02]"
            />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                    active
                      ? "bg-brand text-white shadow-xs"
                      : "text-ink-muted hover:bg-surface/80 hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden rounded-full border border-brand-border bg-brand-soft px-3 py-1 text-xs font-medium text-brand-ink sm:inline-flex">
            on True Markets
          </span>
          <ThemeToggle />
          <a
            href="https://docs.truemarkets.co/gateway"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-brand-ink/40 hover:text-brand-ink"
          >
            API Docs
            <ArrowUpRight aria-hidden className="h-3 w-3" />
            <span className="sr-only">(opens in new tab)</span>
          </a>
        </div>
      </div>

      {/* Mobile Nav */}
      <nav
        aria-label="Main"
        className="scroll-fade-x flex items-center gap-1.5 overflow-x-auto border-t border-line px-4 py-2 pr-10 md:hidden"
      >
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              ref={active ? mobileActiveRef : undefined}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                active
                  ? "bg-brand text-white"
                  : "bg-surface text-ink-muted ring-1 ring-line"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
    {/* Market tape only where prices drive decisions; avoids an idle WebSocket elsewhere */}
    {pathname === "/" && <LiveSpreadTicker />}
    </>
  );
}
