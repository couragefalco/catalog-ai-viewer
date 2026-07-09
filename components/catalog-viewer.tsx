"use client";

import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Maximize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
export type Catalog = { id: string; name: string; numPages: number; file: string };
import type { Citation } from "@/lib/types";
import { track } from "@/lib/analytics";
import { ASSET_PATH } from "@/lib/base-path";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// Worker served locally from /public, prefixed with the basePath so it resolves
// both standalone and behind a reverse proxy.
pdfjs.GlobalWorkerOptions.workerSrc = `${ASSET_PATH}/pdf.worker.min.mjs`;

const ZOOMS = [60, 75, 90, 100, 125, 150, 200];
const BASE_WIDTH = 560;
const PAGE_ASPECT = 1.384;

type CatalogViewerProps = {
  catalog: Catalog;
  catalogs?: Catalog[];
  onSelectCatalog?: (id: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  activeCitation: Citation | null;
};

export function CatalogViewer({
  catalog,
  catalogs,
  onSelectCatalog,
  page,
  onPageChange,
  activeCitation,
}: CatalogViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [numPages, setNumPages] = useState(catalog.numPages);
  const [query, setQuery] = useState("");
  const highlight =
    activeCitation && activeCitation.page === page ? activeCitation : null;
  const pageWidth = (zoom / 100) * BASE_WIDTH;
  const fileUrl = catalog.file.startsWith("/")
    ? `${ASSET_PATH}${catalog.file}`
    : `${ASSET_PATH}/${catalog.file}`;

  const q = query.trim().toLowerCase();
  const filtered = catalogs
    ? q
      ? catalogs.filter((c) => c.name.toLowerCase().includes(q))
      : catalogs
    : [];

  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
    setZoom(next ?? zoom);
  };

  useEffect(() => {
    track("catalog_opened", {
      catalog_id: catalog.id,
      catalog_name: catalog.name,
      catalog_pages: catalog.numPages,
      catalog_count: catalogs?.length ?? 1,
    });
  }, [catalog.id, catalog.name, catalog.numPages, catalogs?.length]);

  return (
    <SidebarProvider
      defaultOpen={false}
      className="h-full min-h-0"
      style={{ "--sidebar-width": "16rem" } as React.CSSProperties}
    >
      {/* Collapsible catalog sidebar */}
      {catalogs && catalogs.length > 1 && onSelectCatalog && (
        <Sidebar collapsible="offcanvas">
          <SidebarHeader className="gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-muted-foreground text-[0.7rem] font-semibold uppercase tracking-wider">
                Kataloge
              </span>
              <Badge variant="secondary" className="font-mono text-[0.6rem]">
                {catalogs.length}
              </Badge>
            </div>
            <SidebarInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Katalog suchen…"
            />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {filtered.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-4 text-center text-xs">
                      Kein Katalog gefunden.
                    </p>
                  ) : (
                    filtered.map((c) => (
                      <SidebarMenuItem key={c.id}>
                        <SidebarMenuButton
                          isActive={c.id === catalog.id}
                          onClick={() => onSelectCatalog(c.id)}
                          tooltip={c.name}
                          className="pr-8"
                        >
                          <FileText className="shrink-0" />
                          <span className="truncate">{c.name}</span>
                        </SidebarMenuButton>
                        <SidebarMenuBadge className="font-mono">
                          {c.numPages}
                        </SidebarMenuBadge>
                      </SidebarMenuItem>
                    ))
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      )}

      {/* Main */}
      <SidebarInset className="h-full min-h-0 overflow-hidden bg-muted/30">
        {/* Toolbar */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
          {catalogs && catalogs.length > 1 && onSelectCatalog && (
            <SidebarTrigger className="-ml-1" />
          )}
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src={`${ASSET_PATH}/igus-logo.svg`}
              alt="igus"
              className="h-5 w-auto shrink-0"
            />
            <p className="truncate text-sm font-medium">{catalog.name}</p>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <ToolbarButton
              label="Vorherige Seite"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </ToolbarButton>
            <span className="shrink-0 whitespace-nowrap px-1 font-mono text-xs tabular-nums">
              <span className="text-foreground">{page}</span>
              <span className="text-muted-foreground"> / {numPages || "…"}</span>
            </span>
            <ToolbarButton
              label="Nächste Seite"
              disabled={!!numPages && page >= numPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <ToolbarButton label="Verkleinern" onClick={() => stepZoom(-1)}>
              <ZoomOut className="h-4 w-4" />
            </ToolbarButton>
            <button
              type="button"
              onClick={() => setZoom(100)}
              className="text-muted-foreground hover:text-foreground w-12 text-center font-mono text-xs tabular-nums"
            >
              {zoom}%
            </button>
            <ToolbarButton label="Vergrößern" onClick={() => stepZoom(1)}>
              <ZoomIn className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <ToolbarButton label="Drehen">
              <RotateCw className="h-4 w-4" />
            </ToolbarButton>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                  <a
                    href={fileUrl}
                    download
                    aria-label="PDF herunterladen"
                    onClick={() =>
                      track("catalog_pdf_downloaded", {
                        catalog_id: catalog.id,
                        catalog_name: catalog.name,
                      })
                    }
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>PDF herunterladen</TooltipContent>
            </Tooltip>
            <ToolbarButton label="Vollbild">
              <Maximize2 className="h-4 w-4" />
            </ToolbarButton>
          </div>
        </div>

        {/* Document: page-thumbnail rail + canvas */}
        <Document
          key={catalog.id}
          file={fileUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<DocStatus label="Dieses Dokument wird geladen…" />}
          error={<DocStatus label="PDF konnte nicht geladen werden." error />}
          className="flex flex-1 overflow-hidden"
        >
          {/* Page rail */}
          <aside className="flex w-24 shrink-0 flex-col items-center gap-3 overflow-y-auto border-r bg-background/40 px-2.5 py-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onPageChange(n)}
                className="group flex w-full shrink-0 flex-col items-center gap-1.5"
              >
                <div
                  className={cn(
                    "overflow-hidden rounded-sm border bg-white shadow-sm ring-offset-background transition",
                    n === page
                      ? "ring-2 ring-primary ring-offset-2"
                      : "opacity-50 group-hover:opacity-100",
                  )}
                >
                  <Page
                    pageNumber={n}
                    width={56}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    loading={<div className="h-[78px] w-[56px] bg-zinc-100" />}
                  />
                </div>
                <span
                  className={cn(
                    "font-mono text-[10px]",
                    n === page ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              </button>
            ))}
          </aside>

          {/* Canvas */}
          <div className="relative flex-1 overflow-auto">
            <div className="flex min-h-full items-start justify-center p-6 lg:p-10">
              <div className="relative shadow-2xl ring-1 ring-black/10">
                <Page
                  key={`${catalog.id}-${page}-${zoom}`}
                  pageNumber={page}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={
                    <div
                      className="flex items-center justify-center bg-white"
                      style={{
                        width: pageWidth,
                        height: pageWidth * PAGE_ASPECT,
                      }}
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
                    </div>
                  }
                />

                {/* citation highlight overlay */}
                {highlight && (
                  <div
                    className="pointer-events-none absolute animate-in fade-in zoom-in-95 duration-300"
                    style={{
                      left: `${highlight.bbox.x * 100}%`,
                      top: `${highlight.bbox.y * 100}%`,
                      width: `${highlight.bbox.w * 100}%`,
                      height: `${highlight.bbox.h * 100}%`,
                    }}
                  >
                    <div className="absolute inset-0 rounded-sm bg-primary/15 ring-2 ring-primary shadow-[0_0_0_4px] shadow-primary/10" />
                    <div className="absolute -top-2.5 left-2 -translate-y-full">
                      <Badge className="whitespace-nowrap text-[0.6rem] shadow-md">
                        Im Chat zitiert
                      </Badge>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Document>
      </SidebarInset>
    </SidebarProvider>
  );
}

function DocStatus({ label, error }: { label: string; error?: boolean }) {
  return (
    <div className="bg-muted/30 flex h-full w-full items-start justify-center p-6 lg:p-10">
      <div className="flex items-center gap-2.5">
        {error ? (
          <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
        ) : (
          <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
        )}
        <p className="text-muted-foreground text-sm">{label}</p>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" {...props}>
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
