import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LiveSpreadTicker } from "@/components/LiveSpreadTicker";
import { TopNav } from "@/components/TopNav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Allot — Non-Custodial Global 401(k) in U.S. Stocks",
  description:
    "Auto-split every USDC paycheck into 136 tokenized U.S. stocks on True Markets Gateway — never below your cash floor, never past your reference-price drift band.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen font-sans antialiased selection:bg-[#F9EFF2] selection:text-[#701735]">
        <TopNav />
        <LiveSpreadTicker />
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-7 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
