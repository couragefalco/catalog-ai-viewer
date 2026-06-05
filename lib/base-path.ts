// Must match `basePath` in next.config.ts. Used to build absolute URLs for
// public assets and API calls so they resolve correctly both on a bare
// deployment and when the app is served under a sub-path (set via
// NEXT_PUBLIC_BASE_PATH, e.g. "/catalog" behind a reverse proxy).
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
