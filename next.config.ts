import type { NextConfig } from "next";

const nextConfig = (phase: string): NextConfig => ({
  allowedDevOrigins: ["192.168.0.153:3000", "192.168.0.153", "172.30.1.38"],
  outputFileTracingExcludes: {
    "/*": ["./local-data/**/*", "./.next/dev/**/*"],
  },
  distDir: phase === "phase-production-build" && process.env.POC_ISOLATED_BUILD === "1"
    ? ".next/poc-production"
    : ".next",
});

export default nextConfig;
