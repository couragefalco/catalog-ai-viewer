import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSupabaseServerClient,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
  canUploadCatalog,
  createCatalogEntry,
  processUpload,
  removeCatalog,
} = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  getOrCreateWorkspaceForUser: vi.fn(),
  listWorkspaceCatalogs: vi.fn(),
  canUploadCatalog: vi.fn(),
  createCatalogEntry: vi.fn(),
  processUpload: vi.fn(),
  removeCatalog: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/account", () => ({
  FREE_QUESTION_LIMIT: 3,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
  canUploadCatalog,
  createCatalogEntry,
}));

vi.mock("@/lib/process-upload", () => ({
  processUpload,
}));

vi.mock("@/lib/store", () => ({
  removeCatalog,
}));

import { POST } from "../app/api/admin/catalogs/route";

function pdfRequest() {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "test.pdf", {
    type: "application/pdf",
  }));
  return new Request("http://localhost/api/admin/catalogs", {
    method: "POST",
    body: form,
  });
}

describe("admin catalogs multipart route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
        }),
      },
    });
    getOrCreateWorkspaceForUser.mockResolvedValue({ id: "ws-1", plan: "free" });
    listWorkspaceCatalogs.mockResolvedValue([]);
    canUploadCatalog.mockReturnValue({ ok: true });
    processUpload.mockResolvedValue({
      id: "catalog-1",
      name: "Test Catalog",
      numPages: 4,
      mode: "full",
      notes: "Notes",
      exampleQuestions: ["Question?"],
    });
    createCatalogEntry.mockResolvedValue({ id: "entry-1" });
    removeCatalog.mockResolvedValue(undefined);
  });

  it("requires a Supabase user before processing multipart uploads", async () => {
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
    });

    const response = await POST(pdfRequest());

    await expect(response.json()).resolves.toEqual({
      error: "Nicht autorisiert",
    });
    expect(response.status).toBe(401);
    expect(processUpload).not.toHaveBeenCalled();
    expect(createCatalogEntry).not.toHaveBeenCalled();
  });

  it("enforces workspace upload limits before returning multipart upload results", async () => {
    canUploadCatalog.mockReturnValueOnce({
      ok: false,
      reason: "FREE_CATALOG_LIMIT",
    });

    const response = await POST(pdfRequest());

    await expect(response.json()).resolves.toEqual({
      error: "Der kostenlose Plan erlaubt einen Katalog.",
    });
    expect(response.status).toBe(402);
    expect(processUpload).toHaveBeenCalledOnce();
    expect(createCatalogEntry).not.toHaveBeenCalled();
    expect(removeCatalog).toHaveBeenCalledWith("catalog-1");
  });
});
