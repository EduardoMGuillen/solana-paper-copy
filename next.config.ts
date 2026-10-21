import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@meteora-ag/dlmm", "@solana/web3.js"],
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
