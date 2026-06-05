import type { NextConfig } from "next";

// Optionally serve the app under a sub-path (e.g. "/catalog") when it sits
// behind a reverse proxy. Set NEXT_PUBLIC_BASE_PATH to enable; defaults to root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
