import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Baseline HTTP security headers applied to every route (US-024).
// CSP uses 'unsafe-inline'+'unsafe-eval' for script-src so Next.js hydration
// and the blocking no-flash theme script in layout.tsx keep working without
// requiring per-request nonces.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline for hydration chunks and the inline
      // theme script; unsafe-eval may be needed by some polyfills/dev tools.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // img-src: data/blob URIs for inline images; https: for article hero
      // images (rendered via plain <img>) and OAuth avatars.
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self'",
      // media-src blob: needed for ArticleSpeech which creates a blob URL
      // from base64 audio returned by the speech API.
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  // HSTS only in production HTTPS deployments.
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Produce a self-contained `.next/standalone` directory for Docker deploys.
  output: "standalone",
  // Restrict the Next.js image optimizer to known hosts only.
  // All current <Image> usages pass `unoptimized` (OAuth avatars, dashboard),
  // so no optimizer traffic exists today — but the wildcard would allow
  // arbitrary SSRF-style image proxying via /_next/image.
  // We allow the two OAuth avatar CDNs for future non-unoptimized use.
  // Article hero images are rendered via a plain <img> tag (not the optimizer)
  // so provider CDN hosts are intentionally omitted here.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
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
