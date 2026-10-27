import path from "node:path";
import type { NextConfig } from "next";

// Pin the project root: a stray lockfile in a parent folder would otherwise move it.
const root = path.resolve(".");

const nextConfig: NextConfig = {
  // The desktop build (scripts/desktop.mjs) needs a self-contained server; the VM keeps `next start`.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: root,
  serverExternalPackages: ["@meteora-ag/dlmm", "@solana/web3.js"],
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
