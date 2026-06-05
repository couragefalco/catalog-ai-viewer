"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/chat-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CATALOGS, DEFAULT_CATALOG_ID } from "@/lib/catalogs";
import type { Citation } from "@/lib/types";

// pdf.js touches browser-only APIs — load the viewer client-side only.
const CatalogViewer = dynamic(
  () => import("@/components/catalog-viewer").then((m) => m.CatalogViewer),
  { ssr: false },
);

export default function Home() {
  const [docId, setDocId] = useState(DEFAULT_CATALOG_ID);
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const catalog = useMemo(
    () => CATALOGS.find((c) => c.id === docId) ?? CATALOGS[0],
    [docId],
  );

  // Clicking a citation jumps the viewer to the page and highlights the region.
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

  return (
    <main className="h-screen w-full overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="62" minSize="40">
          <CatalogViewer
            catalog={catalog}
            catalogs={CATALOGS}
            onSelectCatalog={handleSelectCatalog}
            page={page}
            onPageChange={handlePageChange}
            activeCitation={activeCitation}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38" minSize="26" maxSize="50">
          <ChatPanel
            docId={docId}
            onCite={handleCite}
            activeCitationId={activeCitation?.id ?? null}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
