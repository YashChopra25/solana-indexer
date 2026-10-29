import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Sent with every response. The console loads nothing from other origins
 * (fonts are self-hosted by next/font), so the policy can be strict: only
 * this site's own scripts, styles, images and API.
 *
 * 'unsafe-inline' for scripts is what Next's inline bootstrap needs without a
 * per-request nonce; nothing on the page renders user input as HTML, which is
 * what that allowance would otherwise expose. Dev mode also needs eval and a
 * websocket for hot reload.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Nothing here is meant to be framed; /admin in particular must not be.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // `pg` loads optional native modules at runtime, which the bundler cannot
  // trace. Leaving it external keeps it a plain Node require.
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["16.58.93.201"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
