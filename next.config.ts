import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.elbstream.com" },
      { protocol: "https", hostname: "**.truemarkets.co" },
    ],
  },
};

export default nextConfig;
