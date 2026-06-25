export const FREE_CATALOG_LIMIT = 1;
export const FREE_PAGE_LIMIT = 20;
export const FREE_QUESTION_LIMIT = 3;

export type WorkspacePlan = "free" | "paid";

export function canUploadCatalog(input: {
  plan: WorkspacePlan;
  existingCatalogs: number;
  pages: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.plan === "paid") return { ok: true };
  if (input.existingCatalogs >= FREE_CATALOG_LIMIT) {
    return { ok: false, reason: "FREE_CATALOG_LIMIT" };
  }
  if (input.pages > FREE_PAGE_LIMIT) {
    return { ok: false, reason: "FREE_PAGE_LIMIT" };
  }
  return { ok: true };
}

export function canAskQuestion(input: {
  plan: WorkspacePlan;
  questionCount: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.plan === "paid") return { ok: true };
  if (input.questionCount >= FREE_QUESTION_LIMIT) {
    return { ok: false, reason: "FREE_QUESTION_LIMIT" };
  }
  return { ok: true };
}
