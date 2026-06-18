"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/chat-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { Catalog } from "@/components/catalog-viewer";
import type { Citation } from "@/lib/types";

const CatalogViewer = dynamic(
  () => import("@/components/catalog-viewer").then((m) => m.CatalogViewer),
  { ssr: false },
);

export function CatalogWorkspace({ catalog }: { catalog: Catalog }) {
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const handleCite = (citation: Citation) => {
    setActiveCitation(citation);
    setPage(citation.page);
  };
  const handlePageChange = (next: number) => {
    setPage(next);
    setActiveCitation(null);
  };

  return (
    <main className="h-screen w-full overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="62" minSize="40">
          <CatalogViewer
            catalog={catalog}
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
