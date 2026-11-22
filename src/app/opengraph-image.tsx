import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Allot — Non-Custodial Global 401(k) in U.S. Stocks on True Markets Gateway";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#F6F4EF",
          padding: "56px 64px",
          fontFamily: "Georgia, serif",
          position: "relative",
        }}
      >
        {/* Top Burgundy Bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 14,
            backgroundColor: "#701735",
          }}
        />

        {/* Brand Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="52" viewBox="50 55 510 385">
              <g fill="#701735" fillRule="evenodd">
                <path d="M75 182 354 142 357 151 330 190 374 214 342 260 384 285 349 329 386 349 386 388 75 431 Z M110 248 315 219 315 254 110 283 Z M110 325 264 304 264 338 110 359 Z" />
                <path d="M354 115 508 64 553 298 398 374 425 331 387 303 417 256 377 231 406 181 367 162 Z" />
              </g>
            </svg>
            <div style={{ fontSize: 54, fontWeight: 700, color: "#701735", letterSpacing: -1 }}>
              Allot
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: "#F9EFF2",
              border: "2px solid #EAD2DA",
              borderRadius: 999,
              padding: "10px 22px",
              fontSize: 20,
              fontFamily: "sans-serif",
              fontWeight: 600,
              color: "#701735",
            }}
          >
            Built on True Markets Gateway
          </div>
        </div>

        {/* Main Editorial Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.08,
              color: "#171412",
              letterSpacing: -1.5,
            }}
          >
            Keep your rent safe. Put the rest into U.S. stocks.
          </div>
          <div
            style={{
              fontSize: 26,
              fontFamily: "sans-serif",
              color: "#625B54",
              lineHeight: 1.4,
            }}
          >
            Non-custodial Global 401(k) for USDC earners · 136 tokenized U.S. stocks · Cash-floor
            protection, CeFi CLOB drift routing &amp; browser P-256 signing.
          </div>
        </div>

        {/* Visual Paycheck Split Strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#FFFFFF",
            border: "2px solid #E5E1D8",
            borderRadius: 24,
            padding: "22px 32px",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 15, color: "#625B54", textTransform: "uppercase" }}>
              Retained Cash Floor
            </span>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#171412" }}>$1,000 USDC</span>
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#701735",
              backgroundColor: "#F9EFF2",
              padding: "8px 18px",
              borderRadius: 999,
            }}
          >
            ✂ Auto-Split T+0
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 15, color: "#625B54", textTransform: "uppercase" }}>
              Allotted to U.S. Equities
            </span>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#701735" }}>
              AAPL · NVDA · SpaceX · TSLA
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
