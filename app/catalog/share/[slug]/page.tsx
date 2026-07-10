import { CatalogBrowser } from "@/components/catalog-browser";
import { getShareLink } from "@/lib/share-links";
import { getOrderedClientCatalogs } from "../../catalog-list";

export const dynamic = "force-dynamic";

export default async function ShareCatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [shareLink, catalogs] = await Promise.all([
    getShareLink(slug),
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
