import "server-only";
import { del, get, list, put } from "@vercel/blob";

export type ShareLink = {
  slug: string;
  name: string;
  catalogId: string;
  mode: "document" | "global";
  createdAt: string;
  createdBy: string;
};

const PREFIX = "share-links/";
const ACCESS = { access: "private" as const };
const key = (slug: string) => `${PREFIX}${slug}.json`;

export function normalizeShareSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function getShareLink(slug: string): Promise<ShareLink | null> {
  const normalized = normalizeShareSlug(slug);
  if (!normalized) return null;
  const res = await get(key(normalized), ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return (await new Response(res.stream).json()) as ShareLink;
}

export async function listShareLinks(): Promise<ShareLink[]> {
  const { blobs } = await list({ prefix: PREFIX });
  const links = await Promise.all(
    blobs
      .filter((blob) => blob.pathname.endsWith(".json"))
      .map(async (blob) => {
        const slug = blob.pathname.slice(PREFIX.length, -".json".length);
        return getShareLink(slug);
      }),
  );
  return links
    .filter((link): link is ShareLink => Boolean(link))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveShareLink(input: {
  slug: string;
  name: string;
  catalogId: string;
  mode: "document" | "global";
  createdBy: string;
}): Promise<ShareLink> {
  const slug = normalizeShareSlug(input.slug);
  if (!slug) throw new Error("INVALID_SLUG");

  const link: ShareLink = {
    slug,
    name: input.name.trim() || slug,
    catalogId: input.catalogId,
    mode: input.mode,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  await put(key(slug), JSON.stringify(link), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
  return link;
}

export async function removeShareLink(slug: string): Promise<void> {
  const normalized = normalizeShareSlug(slug);
  if (!normalized) return;
  await del(key(normalized));
}
