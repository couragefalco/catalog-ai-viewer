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
