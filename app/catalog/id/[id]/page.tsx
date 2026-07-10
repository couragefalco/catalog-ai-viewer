import { CatalogShareLinkPage } from "../../share-link-page";

export const dynamic = "force-dynamic";

export default async function CatalogIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogShareLinkPage id={id} />;
}
