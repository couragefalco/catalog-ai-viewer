import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canAskQuestion, canUploadCatalog } from "../lib/account-limits";

describe("canUploadCatalog", () => {
  it("blocks a free workspace after one catalog", () => {
    expect(
      canUploadCatalog({ plan: "free", existingCatalogs: 1, pages: 8 }),
    ).toEqual({ ok: false, reason: "FREE_CATALOG_LIMIT" });
  });

  it("blocks a free workspace above the page limit", () => {
    expect(
      canUploadCatalog({ plan: "free", existingCatalogs: 0, pages: 21 }),
    ).toEqual({ ok: false, reason: "FREE_PAGE_LIMIT" });
  });

  it("allows a free workspace within catalog and page limits", () => {
    expect(
      canUploadCatalog({ plan: "free", existingCatalogs: 0, pages: 20 }),
    ).toEqual({ ok: true });
  });

  it("allows paid workspaces beyond free limits", () => {
    expect(
      canUploadCatalog({ plan: "paid", existingCatalogs: 50, pages: 200 }),
    ).toEqual({ ok: true });
  });
});

describe("canAskQuestion", () => {
  it("allows the first free question", () => {
    expect(canAskQuestion({ plan: "free", questionCount: 0 })).toEqual({
      ok: true,
    });
  });

  it("blocks free catalogs after three questions", () => {
    expect(canAskQuestion({ plan: "free", questionCount: 3 })).toEqual({
      ok: false,
      reason: "FREE_QUESTION_LIMIT",
    });
  });

  it("allows the third free question", () => {
    expect(canAskQuestion({ plan: "free", questionCount: 2 })).toEqual({
      ok: true,
    });
  });

  it("allows paid catalogs beyond the free question limit", () => {
    expect(canAskQuestion({ plan: "paid", questionCount: 999 })).toEqual({
      ok: true,
    });
  });
});

describe("account module wiring", () => {
  it("keeps owned catalog lookup free of workspace creation side effects", () => {
    const source = readFileSync(resolve("lib/account.ts"), "utf8");

    expect(source).not.toContain(
      "const workspace = await getOrCreateWorkspaceForUser({ id: userId });",
    );
  });

  it("uses an RPC for atomic question count enforcement", () => {
    const accountSource = readFileSync(resolve("lib/account.ts"), "utf8");
    const migrationSource = readFileSync(
      resolve("supabase/migrations/20260623_catalog_saas_foundation.sql"),
      "utf8",
    );

    expect(accountSource).toContain('.rpc("increment_question_count_if_allowed"');
    expect(migrationSource).toContain(
      "create or replace function public.increment_question_count_if_allowed",
    );
  });
});
