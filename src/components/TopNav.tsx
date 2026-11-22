"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, FileCheck2, Landmark, Layers, Link2, Scale } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Payday Studio", icon: Layers },
  { href: "/rebalance", label: "Rebalancer", icon: Scale },
  { href: "/pay/femi", label: "USDC Paylink", icon: Link2 },
  { href: "/orders", label: "Holdings & CLOB", icon: Landmark },
  { href: "/receipts", label: "Receipts", icon: FileCheck2 },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[#E5E1D8] bg-[#F6F4EF]/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-7">
          <Link href="/" className="group flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/allot-logo.svg"
              alt="Allot — Global 401(k) on True Markets"
              className="h-8 w-auto transition duration-200 group-hover:scale-[1.02]"
            />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href === "/pay/femi" ? "/pay" : href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                    active
                      ? "bg-[#701735] text-white shadow-xs"
                      : "text-[#575049] hover:bg-white/80 hover:text-[#171412]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-[#EAD2DA] bg-[#F9EFF2] px-3 py-1 text-xs font-medium text-[#701735] sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#701735] animate-pulse" />
            True Markets Gateway
          </span>
          <a
            href="https://docs.truemarkets.co/gateway"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[#E5E1D8] bg-white px-3 py-1.5 text-xs font-medium text-[#575049] transition hover:border-[#701735]/40 hover:text-[#701735]"
          >
            API Docs
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-[#E5E1D8] px-4 py-2 md:hidden">
        {NAV_ITEMS.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href === "/pay/femi" ? "/pay" : href);
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                active
                  ? "bg-[#701735] text-white"
                  : "bg-white text-[#575049] ring-1 ring-[#E5E1D8]"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
