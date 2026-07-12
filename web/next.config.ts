import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  // The dev rewrite proxy below defaults to a ~30s timeout, but some backend
  // endpoints do slow one-shot LLM generation (goal decompose / daily-plan
  // preview take 40–60s) and would otherwise 500 before the backend responds.
  experimental: {
    proxyTimeout: 120_000,
  },
  async rewrites() {
    // BACKEND_ORIGIN：容器/自托管场景下 backend 不在 localhost（如 compose 里的 http://backend:8787）。
    const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:8787';
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
