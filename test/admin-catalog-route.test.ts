import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, getOwnedCatalogEntry, patchCatalog, removeCatalog } =
  vi.hoisted(() => ({
    createSupabaseServerClient: vi.fn(),
    getOwnedCatalogEntry: vi.fn(),
    patchCatalog: vi.fn(),
    removeCatalog: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient,
}));

vi.mock("@/lib/account", () => ({
  getOwnedCatalogEntry,
}));

vi.mock("@/lib/store", () => ({
  patchCatalog,
  removeCatalog,
}));

import { DELETE, PATCH } from "../app/api/admin/catalogs/[id]/route";

describe("admin catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
    });
    getOwnedCatalogEntry.mockResolvedValue({
      blob_catalog_id: "catalog-1",
      workspace_id: "ws-1",
    });
    patchCatalog.mockResolvedValue({ id: "catalog-1" });
    removeCatalog.mockResolvedValue(undefined);
  });

  it("rejects patch requests without a signed-in user", async () => {
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/catalogs/catalog-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated" }),
        headers: {
          "content-type": "application/json",
        },
      }),
      { params: Promise.resolve({ id: "catalog-1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      error: "Nicht autorisiert",
    });
    expect(response.status).toBe(401);
    expect(getOwnedCatalogEntry).not.toHaveBeenCalled();
    expect(patchCatalog).not.toHaveBeenCalled();
  });

  it("rejects deletes for catalogs the user does not own", async () => {
    getOwnedCatalogEntry.mockResolvedValueOnce(null);

    const response = await DELETE(
      new Request("http://localhost/api/admin/catalogs/catalog-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "catalog-1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      error: "Nicht gefunden",
    });
    expect(response.status).toBe(404);
    expect(getOwnedCatalogEntry).toHaveBeenCalledWith("catalog-1", "user-1");
    expect(removeCatalog).not.toHaveBeenCalled();
  });
});
