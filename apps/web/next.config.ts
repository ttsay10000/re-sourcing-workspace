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
    ];
  },
};

export default nextConfig;
