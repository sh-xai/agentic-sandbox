// ABOUTME: Next.js configuration for the observability dashboard.
// ABOUTME: Enables standalone output for Docker deployment.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
