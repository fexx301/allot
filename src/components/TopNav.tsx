"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, FileCheck2, Landmark, Layers, Link2, Scale, ShieldCheck } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Payday Studio", icon: Layers },
  { href: "/rebalance", label: "Drift Rebalancer", icon: Scale },
  { href: "/pay/demo-engineer", label: "USDC Paylink", icon: Link2 },
  { href: "/orders", label: "Wallet & CLOB", icon: Landmark },
  { href: "/receipts", label: "Receipts", icon: FileCheck2 },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[#E5E4DE] bg-[#F7F6F2]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-xs transition group-hover:bg-emerald-800">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-semibold tracking-tight text-slate-900 leading-none">
                Allot
              </span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-stone-500">
                Global 401(k) · True Markets
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href === "/pay/demo-engineer" ? "/pay" : href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-white text-slate-900 shadow-xs ring-1 ring-[#E5E4DE]"
                      : "text-stone-600 hover:bg-white/60 hover:text-slate-900"
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
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            True Markets Gateway Live
          </span>
          <a
            href="https://docs.truemarkets.co/gateway"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:text-slate-900"
          >
            Gateway Docs
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-[#E5E4DE] px-4 py-2 md:hidden">
        {NAV_ITEMS.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href === "/pay/demo-engineer" ? "/pay" : href);
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${
                active ? "bg-slate-900 text-white" : "bg-white text-stone-700 ring-1 ring-[#E5E4DE]"
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
