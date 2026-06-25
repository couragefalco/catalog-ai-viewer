export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set");
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  return { url, anonKey };
}

export function getSupabaseAdminEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  return { url, serviceRoleKey };
}
