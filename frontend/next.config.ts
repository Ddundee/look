import path from "node:path";
import type { NextConfig } from "next";

// The browser only ever talks to this Next.js server. Every /api/* and
// /health request is transparently proxied to the backend container over
// the internal Docker network, so the web UI never needs CORS and the
// session cookie is issued for whatever address the user is actually
// browsing from (localhost, LAN IP, or a Tailscale hostname).
//
// Note: for a standalone production build (see Dockerfile), Next.js
// resolves this rewrite destination once at build time — changing
// INTERNAL_API_BASE_URL after the image is built has no effect. Local
// `next dev` / `next start` DO re-read it on every boot, which is what
// frontend/.env.local.example is for.
const backendUrl = process.env.INTERNAL_API_BASE_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root to this directory. Without this, Next.js walks
  // up looking for a lockfile and may latch onto an unrelated one further
  // up the filesystem, which throws off standalone-build file tracing.
  outputFileTracingRoot: path.join(__dirname),
  // The dedicated Inbox and Upcoming pages were removed (see the README's
  // "Views" note). Old bookmarks land on the closest surviving view:
  // undated "inbox" tasks pre-filtered in All Tasks, and the Calendar for
  // what's coming up. 307 (not permanent) so browsers don't cache them.
  async redirects() {
    return [
      { source: "/inbox", destination: "/tasks?status=inbox", permanent: false },
      { source: "/upcoming", destination: "/calendar", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      { source: "/health", destination: `${backendUrl}/health` },
    ];
  },
};

export default nextConfig;
