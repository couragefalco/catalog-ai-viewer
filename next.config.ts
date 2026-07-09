import type { NextConfig } from "next";

// Optionally serve the app under a sub-path (e.g. "/catalog") when it sits
// behind a reverse proxy. Set NEXT_PUBLIC_BASE_PATH to enable; defaults to root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;
const catalogAssetPath = "/catalog";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  assetPrefix: basePath ? undefined : catalogAssetPath,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const postHogProxy = [
      {
        source: "/ph/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ph/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
    if (basePath) return postHogProxy;
    return [
      ...postHogProxy,
      {
        source: `${catalogAssetPath}/ph/static/:path*`,
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: `${catalogAssetPath}/ph/:path*`,
        destination: "https://eu.i.posthog.com/:path*",
      },
      {
        source: `${catalogAssetPath}/_next/:path*`,
        destination: "/_next/:path*",
      },
      {
        source: `${catalogAssetPath}/api/:path*`,
        destination: "/api/:path*",
      },
      {
        source: `${catalogAssetPath}/pdf.worker.min.mjs`,
        destination: "/pdf.worker.min.mjs",
      },
      {
        source: `${catalogAssetPath}/igus-logo.svg`,
        destination: "/igus-logo.svg",
      },
    ];
  },
  // mupdf ships a large WASM binary; keep it out of the bundler so it loads
  // natively in the Node.js runtime of our route handlers.
  serverExternalPackages: ["mupdf"],
};

export default nextConfig;
