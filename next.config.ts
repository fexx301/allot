import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.elbstream.com" },
      { protocol: "https", hostname: "**.truemarkets.co" },
    ],
  },
};

export default nextConfig;
