import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAdminUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) return data.user.id;
  } catch {
    // Fall back to the legacy password session below.
  }

  try {
    return (await requireAdmin()) ? "password-admin" : null;
  } catch {
    return null;
  }
}
