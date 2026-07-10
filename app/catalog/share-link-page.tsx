import { CatalogBrowser } from "@/components/catalog-browser";
import { getShareLink } from "@/lib/share-links";
import { getOrderedClientCatalogs } from "./catalog-list";

export async function CatalogShareLinkPage({ id }: { id: string }) {
  const [shareLink, catalogs] = await Promise.all([
    getShareLink(id),
    getOrderedClientCatalogs(),
  ]);

  return (
    <CatalogBrowser
      catalogs={catalogs}
      initialCatalogId={shareLink?.catalogId}
      initialChatScope={shareLink?.mode ?? "document"}
      shareSlug={shareLink?.slug}
    />
  );
}
