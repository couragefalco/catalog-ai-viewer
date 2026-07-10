"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/chat-panel";
import { track } from "@/lib/analytics";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { Catalog } from "@/components/catalog-viewer";
import type { Citation } from "@/lib/types";

// pdf.js touches browser-only APIs - load the viewer client-side only.
const CatalogViewer = dynamic(
  () => import("@/components/catalog-viewer").then((m) => m.CatalogViewer),
  { ssr: false },
);

// Multi-catalog browse view: the viewer with its collapsible catalog sidebar
// for switching between catalogs, plus the chat panel. Selecting a catalog in
// the sidebar swaps the document in place (no navigation).
export function CatalogBrowser({
  catalogs,
  initialCatalogId,
  initialChatScope = "document",
  shareSlug,
}: {
  catalogs: Catalog[];
  initialCatalogId?: string;
  initialChatScope?: "document" | "global";
  shareSlug?: string;
}) {
  const [docId, setDocId] = useState(initialCatalogId ?? catalogs[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const trackedShareOpen = useRef(false);

  const catalog = useMemo(
    () => catalogs.find((c) => c.id === docId) ?? catalogs[0],
    [catalogs, docId],
  );

  useEffect(() => {
    if (!shareSlug || !catalog || trackedShareOpen.current) return;
    trackedShareOpen.current = true;
    track("catalog_share_link_opened", {
      share_slug: shareSlug,
      catalog_id: catalog.id,
      catalog_name: catalog.name,
      initial_chat_scope: initialChatScope,
    });
  }, [catalog, initialChatScope, shareSlug]);

  const handleCite = (citation: Citation) => {
    const targetCatalog = citation.catalogId
      ? catalogs.find((c) => c.id === citation.catalogId)
      : catalog;
    track("catalog_citation_clicked", {
      catalog_id: targetCatalog?.id ?? catalog.id,
      catalog_name: targetCatalog?.name ?? catalog.name,
      citation_id: citation.id,
      citation_page: citation.page,
      citation_catalog_id: citation.catalogId,
      citation_catalog_name: citation.catalogName,
    });
    if (targetCatalog && targetCatalog.id !== catalog.id) {
      setDocId(targetCatalog.id);
    }
    setActiveCitation(citation);
    setPage(citation.page);
  };

  const handlePageChange = (next: number) => {
    track("catalog_page_changed", {
      catalog_id: catalog.id,
      catalog_name: catalog.name,
      from_page: page,
      to_page: next,
    });
    setPage(next);
    setActiveCitation(null);
  };

  const handleSelectCatalog = (id: string) => {
    const nextCatalog = catalogs.find((c) => c.id === id);
    track("catalog_selected", {
      catalog_id: id,
      catalog_name: nextCatalog?.name,
      previous_catalog_id: catalog.id,
      previous_catalog_name: catalog.name,
    });
    setDocId(id);
    setPage(1);
    setActiveCitation(null);
  };

  if (!catalog) return null;

  return (
    <main className="h-screen w-full overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="62" minSize="40">
          <CatalogViewer
            catalog={catalog}
            catalogs={catalogs}
            onSelectCatalog={handleSelectCatalog}
            page={page}
            onPageChange={handlePageChange}
            activeCitation={activeCitation}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38" minSize="26" maxSize="50">
          <ChatPanel
            docId={catalog.id}
            onCite={handleCite}
            activeCitationId={activeCitation?.id ?? null}
            enableGlobalChat={catalogs.length > 1}
            initialScope={initialChatScope}
            shareSlug={shareSlug}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
