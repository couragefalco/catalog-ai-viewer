import { CatalogShareLinkPage } from "../../share-link-page";

export const dynamic = "force-dynamic";

export default async function ShareCatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CatalogShareLinkPage id={slug} />;
}
