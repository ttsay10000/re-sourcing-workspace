import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
    ],
  },
  async redirects() {
    return [
      // Yield map moved under Pipeline (with the new Comp Analysis sibling).
      { source: "/yield-map", destination: "/pipeline/yield-map", permanent: false },
      { source: "/yield-map/:path*", destination: "/pipeline/yield-map/:path*", permanent: false },
      // Market docs moved under Pipeline as well.
      { source: "/market-docs", destination: "/pipeline/market-docs", permanent: false },
      { source: "/market-docs/:path*", destination: "/pipeline/market-docs/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
