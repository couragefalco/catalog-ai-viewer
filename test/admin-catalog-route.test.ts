import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  deleteCalls,
  patchCatalog,
  removeCatalog,
  state,
} = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  deleteCalls: [] as unknown[],
  patchCatalog: vi.fn(),
  removeCatalog: vi.fn(),
  state: {
    catalog: null as { id: string; blob_catalog_id: string; workspace_id: string } | null,
    workspace: null as { id: string } | null,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/account", async () => {
  const actual = await vi.importActual("../lib/account");
  return actual;
});

vi.mock("@/lib/store", () => ({
  patchCatalog,
  removeCatalog,
}));

import { DELETE, PATCH } from "../app/api/admin/catalogs/[id]/route";

describe("admin catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCalls.length = 0;
    state.catalog = {
      id: "entry-1",
      blob_catalog_id: "catalog-1",
      workspace_id: "ws-1",
    };
    state.workspace = { id: "ws-1" };
    createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
    });
    createSupabaseAdminClient.mockImplementation(() => ({
      from: (table: string) => {
        if (table === "catalog_entries") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: state.catalog,
                  error: null,
                }),
              }),
            }),
            delete: () => ({
              eq: (column: string, value: string) => {
                deleteCalls.push({ column, value });
                return {
                  eq: (nextColumn: string, nextValue: string) => {
                    deleteCalls.push({ column: nextColumn, value: nextValue });
                    return Promise.resolve({ error: null });
                  },
                };
              },
            }),
          };
        }

        if (table === "workspaces") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: state.workspace,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    }));
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
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(patchCatalog).not.toHaveBeenCalled();
  });

  it("rejects patch requests for workspace members who are not owners", async () => {
    state.workspace = null;

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
      error: "Nicht gefunden",
    });
    expect(response.status).toBe(404);
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(patchCatalog).not.toHaveBeenCalled();
  });

  it("rejects deletes for catalogs the user does not own", async () => {
    state.workspace = null;

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
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(removeCatalog).not.toHaveBeenCalled();
  });

  it("removes the owned catalog entry when deleting a catalog", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/admin/catalogs/catalog-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "catalog-1" }) },
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(removeCatalog).toHaveBeenCalledWith("catalog-1");
    expect(deleteCalls).toEqual([
      { column: "blob_catalog_id", value: "catalog-1" },
      { column: "workspace_id", value: "ws-1" },
    ]);
  });
});
