// Must match `basePath` in next.config.ts for API calls.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Public assets need to be reachable through the igus `/catalog` proxy even
// when the Poase app itself is served from the domain root.
export const ASSET_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/catalog";
