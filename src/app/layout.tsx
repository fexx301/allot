import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
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
  metadataBase: new URL("https://allot-ashen.vercel.app"),
  title: "Allot — Non-Custodial Global 401(k) in U.S. Stocks",
  description:
    "Auto-split every USDC paycheck into 136 tokenized U.S. stocks on True Markets Gateway — never below your cash floor, never past your reference-price drift band.",
  openGraph: {
    title: "Allot — Non-Custodial Global 401(k) in U.S. Stocks",
    description:
      "Keep your rent safe. Put the rest into 136 tokenized U.S. stocks on True Markets Gateway with cash-floor protection, CeFi CLOB drift routing, and browser P-256 signing.",
    url: "https://allot-ashen.vercel.app",
    siteName: "Allot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Allot — Non-Custodial Global 401(k) in U.S. Stocks",
    description:
      "Auto-split every USDC paycheck into 136 tokenized U.S. stocks on True Markets Gateway.",
  },
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
      <body className="min-h-screen font-sans antialiased selection:bg-brand-soft selection:text-brand-ink">
        <TopNav />
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-7 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
