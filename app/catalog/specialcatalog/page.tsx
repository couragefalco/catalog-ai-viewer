import { CatalogShareLinkPage } from "../share-link-page";

export const dynamic = "force-dynamic";

export default async function SpecialCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id = "" } = await searchParams;
  return <CatalogShareLinkPage id={id} />;
}
