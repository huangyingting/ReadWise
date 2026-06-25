import type { NextConfig } from "next";
import {
  buildSecurityHeaders,
  IMAGE_REMOTE_PATTERNS,
  SERVER_EXTERNAL_PACKAGES,
} from "./src/lib/security/headers";

const isProduction = process.env.NODE_ENV === "production";

const DEV_WATCH_IGNORES = [
  "**/prisma/*.db",
  "**/prisma/*.db-*",
  "**/prisma/*.db-journal",
  "**/prisma/*.db-shm",
  "**/prisma/*.db-wal",
  "**/backups/**",
  "**/.media/**",
];

// Baseline HTTP security headers applied to every route (US-024).
// Policy is defined in src/lib/security/headers.ts and reused here.
const securityHeaders = buildSecurityHeaders({ production: isProduction });

const nextConfig: NextConfig = {
  // Produce a self-contained `.next/standalone` directory for Docker deploys.
  // Gated to production so local `npm run dev` doesn't emit the standalone
  // artefact (which is only needed by the Dockerfile / container runtime).
  ...(isProduction ? { output: "standalone" } : {}),
  // Keep the OpenTelemetry Node SDK out of the webpack bundle (RW-032). It is
  // only ever loaded from `src/instrumentation.ts` in the Node runtime, uses
  // native require-in-the-middle instrumentation, and pulls OPTIONAL exporters
  // (e.g. jaeger) that we don't install. Externalizing avoids bundling it (and
  // the harmless "Can't resolve @opentelemetry/exporter-jaeger" build warning)
  // and is the Next.js-recommended setup for manual OTel.
  serverExternalPackages: [...SERVER_EXTERNAL_PACKAGES],
  // Restrict the Next.js image optimizer to known hosts only.
  // All current <Image> usages pass `unoptimized` (OAuth avatars, dashboard),
  // so no optimizer traffic exists today — but the wildcard would allow
  // arbitrary SSRF-style image proxying via /_next/image.
  // We allow the two OAuth avatar CDNs for future non-unoptimized use.
  // Article hero images are rendered via a plain <img> tag (not the optimizer)
  // so provider CDN hosts are intentionally omitted here.
  images: {
    remotePatterns: [...IMAGE_REMOTE_PATTERNS],
  },
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: DEV_WATCH_IGNORES,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
