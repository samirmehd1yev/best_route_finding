import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it out of the webpack bundle.
  serverExternalPackages: ["better-sqlite3"],
  // db.ts opens data/ayna.sqlite via process.cwd(), which file tracing can't see.
  outputFileTracingIncludes: { "/**": ["./data/ayna.sqlite"] },
};

export default nextConfig;
