import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSupabaseServerClient,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
  canUploadCatalog,
  createCatalogEntry,
  getBlobBytes,
  removeBlob,
  removeCatalog,
  processUpload,
} = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  getOrCreateWorkspaceForUser: vi.fn(),
  listWorkspaceCatalogs: vi.fn(),
  canUploadCatalog: vi.fn(),
  createCatalogEntry: vi.fn(),
  getBlobBytes: vi.fn(),
  removeBlob: vi.fn(),
  removeCatalog: vi.fn(),
  processUpload: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient,
}));

vi.mock("@/lib/account", () => ({
  FREE_QUESTION_LIMIT: 3,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
  canUploadCatalog,
  createCatalogEntry,
}));

vi.mock("@/lib/store", () => ({
  getBlobBytes,
  removeBlob,
  removeCatalog,
}));

vi.mock("@/lib/process-upload", () => ({
  processUpload,
}));

import { POST } from "../app/api/admin/ingest/route";

describe("admin ingest route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
        }),
      },
    });
    getBlobBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    getOrCreateWorkspaceForUser.mockResolvedValue({ id: "ws-1", plan: "paid" });
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
    createCatalogEntry.mockRejectedValue(new Error("db write failed"));
    removeBlob.mockResolvedValue(undefined);
    removeCatalog.mockResolvedValue(undefined);
  });

  it("keeps processed data intact when catalog entry creation fails after upload processing", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/ingest", {
        method: "POST",
        body: JSON.stringify({
          pathname: "pending/test.pdf",
          filename: "test.pdf",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "PDF konnte nicht verarbeitet werden.",
    });
    expect(response.status).toBe(422);
    expect(removeBlob).not.toHaveBeenCalled();
    expect(removeCatalog).not.toHaveBeenCalled();
  });
});
