"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/chat-panel";
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
export function CatalogBrowser({ catalogs }: { catalogs: Catalog[] }) {
  const [docId, setDocId] = useState(catalogs[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const catalog = useMemo(
    () => catalogs.find((c) => c.id === docId) ?? catalogs[0],
    [catalogs, docId],
  );

  const handleCite = (citation: Citation) => {
    setActiveCitation(citation);
    setPage(citation.page);
  };

  const handlePageChange = (next: number) => {
    setPage(next);
    setActiveCitation(null);
  };

  const handleSelectCatalog = (id: string) => {
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
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
