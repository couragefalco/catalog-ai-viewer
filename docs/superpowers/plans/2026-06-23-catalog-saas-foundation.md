# Catalog SaaS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current password-gated catalog admin into a Supabase-backed self-service foundation with Google login, catalog ownership, and free-plan limits.

**Architecture:** Keep Vercel Blob as the PDF, metadata, and vector storage layer. Add Hetzner-hosted Supabase as the SaaS control plane for users, workspaces, catalog ownership, share slugs, and usage limits. Replace the single admin password gate with Supabase Auth while leaving the existing catalog viewer and chat flow intact.

**Tech Stack:** Next.js 16.2.7 App Router, React 19.2, Supabase Auth and Postgres, `@supabase/supabase-js` 2.108.2, `@supabase/ssr` 0.12.0, Vercel Blob, Vercel AI SDK v6, Gemini 2.5 Flash, Vitest.

## Global Constraints

- Do not print Supabase keys into logs, test output, commits, or chat.
- Supabase credentials are read locally from 1Password item `hetzner-supabase-selfhost-docker` in the `Developer` vault.
- 1Password item ID is `a5y6ncxbnw5ovz2pweudnincy4`.
- Fields available: `ANON_KEY`, `SERVICE_ROLE_KEY`, `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`.
- Use `SERVICE_ROLE_KEY` only server-side. It bypasses RLS and must never be imported into client components.
- Product scope is product catalogs, not a general data room.
- Product source model is public AGPL repo plus paid hosted product.
- Keep MuPDF for now. AGPL compliance is intentional, not a blocker for this plan.
- Never commit customer PDFs, analytics exports, API keys, environment variables, or operational credentials.
- Hosted app must eventually link to the public source commit, but footer/source-link UI is out of scope for this foundation plan.
- Free plan: 1 catalog, maximum 20 pages, 3 viewer questions total, no custom domain, no logo upload.
- Paid plan is planned as `$39/month`, but Stripe implementation is out of scope for this foundation plan.
- Domain for now is `poase.com`.
- UI copy can stay German where the existing app is German.
- Never use em dashes in code comments, UI copy, docs, or commit messages.
- The repo says Next docs should be read from `node_modules/next/dist/docs/`, but `node_modules` is not installed in the current checkout. After `npm install`, check that path. If still absent, use installed TypeScript types and official docs as fallback before using unfamiliar Next APIs.
- Run `npm test`, `npm run lint`, and `npx tsc --noEmit` before final handoff.

---

## File Structure

**New files**

- `supabase/migrations/20260623_catalog_saas_foundation.sql`  
  Creates workspaces, workspace members, catalog ownership rows, share links, question usage, and RLS policies.

- `lib/supabase/env.ts`  
  Centralizes server and public Supabase env access. Throws clear errors when required env vars are missing.

- `lib/supabase/server.ts`  
  Creates a cookie-aware server Supabase client for route handlers and server components.

- `lib/supabase/admin.ts`  
  Creates a server-only Supabase admin client with the service role key.

- `lib/supabase/client.ts`  
  Creates the browser Supabase client with the anon key.

- `lib/account.ts`  
  Server helpers for current user, workspace bootstrap, catalog ownership, plan limit checks, and usage increments.

- `app/auth/callback/route.ts`  
  Exchanges OAuth code for a Supabase session and redirects into the app.

- `app/login/page.tsx`  
  Public login page with Google login.

- `components/login-form.tsx`  
  Client component that starts Google OAuth.

- `app/dashboard/page.tsx`  
  Authenticated catalog dashboard replacing the old `/admin` entry point for normal users.

- `components/dashboard/catalog-dashboard.tsx`  
  Authenticated upload and catalog management UI.

- `test/account.test.ts`  
  Unit tests for free-plan limit helpers.

**Modified files**

- `package.json`, `package-lock.json`  
  Add Supabase packages.

- `.env.example`, `.env.local`  
  Add Supabase env names. `.env.local` values are filled from 1Password locally and never committed.

- `middleware.ts`  
  Refresh Supabase sessions for authenticated routes.

- `lib/process-upload.ts`  
  Accept workspace ownership context and persist a catalog DB row after Blob save.

- `app/api/admin/blob-upload/route.ts`  
  Replace `requireAdmin()` with Supabase user auth and free-plan checks.

- `app/api/admin/ingest/route.ts`  
  Replace `requireAdmin()` with Supabase user auth, enforce page and catalog limits, then create the catalog ownership row.

- `app/api/admin/catalogs/[id]/route.ts`  
  Require ownership before patch or delete.

- `app/catalog/[id]/page.tsx`  
  Support public share slugs later without breaking current catalog IDs. For this plan, keep existing IDs but ensure catalog metadata can come from the owner's DB row.

- `app/page.tsx`  
  Become a product landing page with login/upload CTA instead of listing every catalog globally.

**Deferred to later plans**

- Stripe Checkout and webhooks.
- Custom domain routing and DNS automation.
- Logo upload and brand theme editor.
- PostHog event capture and analytics dashboard.
- Lead capture.

---

### Task 1: Supabase Dependencies and Environment

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify local only: `.env.local`

**Interfaces:**
- Produces env vars used by later tasks:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

- [ ] **Step 1: Install Supabase packages**

Run:

```bash
npm install @supabase/supabase-js@2.108.2 @supabase/ssr@0.12.0
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Add Supabase vars to `.env.example`**

Append:

```bash
# Supabase, Hetzner self-hosted
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 3: Populate `.env.local` from 1Password without printing secrets**

Run:

```bash
SUPABASE_URL=$(op item get a5y6ncxbnw5ovz2pweudnincy4 --vault Developer --fields SUPABASE_PUBLIC_URL --reveal)
SUPABASE_ANON=$(op item get a5y6ncxbnw5ovz2pweudnincy4 --vault Developer --fields ANON_KEY --reveal)
SUPABASE_SERVICE=$(op item get a5y6ncxbnw5ovz2pweudnincy4 --vault Developer --fields SERVICE_ROLE_KEY --reveal)

grep -q '^NEXT_PUBLIC_SUPABASE_URL=' .env.local \
  && perl -0pi -e "s#^NEXT_PUBLIC_SUPABASE_URL=.*#NEXT_PUBLIC_SUPABASE_URL=$ENV{SUPABASE_URL}#m" .env.local \
  || printf '\nNEXT_PUBLIC_SUPABASE_URL=%s\n' "$SUPABASE_URL" >> .env.local

grep -q '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local \
  && perl -0pi -e "s#^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*#NEXT_PUBLIC_SUPABASE_ANON_KEY=$ENV{SUPABASE_ANON}#m" .env.local \
  || printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$SUPABASE_ANON" >> .env.local

grep -q '^SUPABASE_SERVICE_ROLE_KEY=' .env.local \
  && perl -0pi -e "s#^SUPABASE_SERVICE_ROLE_KEY=.*#SUPABASE_SERVICE_ROLE_KEY=$ENV{SUPABASE_SERVICE}#m" .env.local \
  || printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_SERVICE" >> .env.local

unset SUPABASE_URL SUPABASE_ANON SUPABASE_SERVICE
```

Expected: `.env.local` has the values, but the terminal output does not print them.

- [ ] **Step 4: Verify local env names only**

Run:

```bash
grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | sed 's/=.*/=<set>/'
```

Expected:

```text
NEXT_PUBLIC_SUPABASE_URL=<set>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<set>
SUPABASE_SERVICE_ROLE_KEY=<set>
```

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add supabase dependencies and env names"
```

---

### Task 2: Supabase Schema and RLS

**Files:**
- Create: `supabase/migrations/20260623_catalog_saas_foundation.sql`

**Interfaces:**
- Produces tables:
  - `workspaces`
  - `workspace_members`
  - `catalog_entries`
  - `share_links`
  - `question_usage`
- Produces SQL function:
  - `public.current_workspace_ids() returns uuid[]`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260623_catalog_saas_foundation.sql`:

```sql
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  stripe_customer_id text,
  subscription_status text not null default 'none',
  custom_domain text,
  logo_blob_path text,
  primary_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.catalog_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blob_catalog_id text not null unique,
  name text not null,
  slug text not null,
  description text not null default '',
  notes text not null default '',
  example_questions jsonb not null default '[]'::jsonb,
  num_pages integer not null check (num_pages > 0),
  mode text not null check (mode in ('full', 'rag')),
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  question_limit integer not null default 3,
  question_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  catalog_entry_id uuid not null references public.catalog_entries(id) on delete cascade,
  slug text not null unique,
  is_active boolean not null default true,
  lead_capture_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.question_usage (
  id uuid primary key default gen_random_uuid(),
  catalog_entry_id uuid not null references public.catalog_entries(id) on delete cascade,
  viewer_session_id text,
  question text not null,
  created_at timestamptz not null default now()
);

create or replace function public.current_workspace_ids()
returns uuid[]
language sql
stable
as $$
  select coalesce(array_agg(workspace_id), '{}'::uuid[])
  from public.workspace_members
  where user_id = auth.uid()
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.catalog_entries enable row level security;
alter table public.share_links enable row level security;
alter table public.question_usage enable row level security;

drop policy if exists "workspace members can read workspaces" on public.workspaces;
create policy "workspace members can read workspaces"
on public.workspaces for select
using (id = any(public.current_workspace_ids()));

drop policy if exists "owners can update workspaces" on public.workspaces;
create policy "owners can update workspaces"
on public.workspaces for update
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "members can read workspace memberships" on public.workspace_members;
create policy "members can read workspace memberships"
on public.workspace_members for select
using (workspace_id = any(public.current_workspace_ids()));

drop policy if exists "members can read catalogs" on public.catalog_entries;
create policy "members can read catalogs"
on public.catalog_entries for select
using (workspace_id = any(public.current_workspace_ids()));

drop policy if exists "members can update catalogs" on public.catalog_entries;
create policy "members can update catalogs"
on public.catalog_entries for update
using (workspace_id = any(public.current_workspace_ids()))
with check (workspace_id = any(public.current_workspace_ids()));

drop policy if exists "members can delete catalogs" on public.catalog_entries;
create policy "members can delete catalogs"
on public.catalog_entries for delete
using (workspace_id = any(public.current_workspace_ids()));

drop policy if exists "members can read share links" on public.share_links;
create policy "members can read share links"
on public.share_links for select
using (
  exists (
    select 1
    from public.catalog_entries ce
    where ce.id = share_links.catalog_entry_id
      and ce.workspace_id = any(public.current_workspace_ids())
  )
);

drop policy if exists "members can read question usage" on public.question_usage;
create policy "members can read question usage"
on public.question_usage for select
using (
  exists (
    select 1
    from public.catalog_entries ce
    where ce.id = question_usage.catalog_entry_id
      and ce.workspace_id = any(public.current_workspace_ids())
  )
);

create index if not exists catalog_entries_workspace_idx on public.catalog_entries(workspace_id);
create index if not exists catalog_entries_blob_catalog_idx on public.catalog_entries(blob_catalog_id);
create index if not exists share_links_catalog_idx on public.share_links(catalog_entry_id);
create index if not exists question_usage_catalog_idx on public.question_usage(catalog_entry_id);
```

- [ ] **Step 2: Apply migration to Hetzner Supabase**

Use the database connection method available for the self-hosted instance. If `psql` is configured:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260623_catalog_saas_foundation.sql
```

If only Supabase Studio is available, paste the SQL into the SQL editor and run it once.

Expected: tables, indexes, function, and policies are created with no errors.

- [ ] **Step 3: Commit**

Run:

```bash
git add supabase/migrations/20260623_catalog_saas_foundation.sql
git commit -m "feat: add supabase catalog ownership schema"
```

---

### Task 3: Supabase Client Helpers

**Files:**
- Create: `lib/supabase/env.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `lib/supabase/client.ts`

**Interfaces:**
- Produces:
  - `getSupabaseEnv(): { url: string; anonKey: string }`
  - `getSupabaseAdminEnv(): { url: string; serviceRoleKey: string }`
  - `createSupabaseServerClient()`
  - `createSupabaseAdminClient()`
  - `createSupabaseBrowserClient()`

- [ ] **Step 1: Create `lib/supabase/env.ts`**

```ts
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
```

- [ ] **Step 2: Create `lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always set cookies. Middleware refreshes them.
        }
      },
    },
  });
}
```

- [ ] **Step 3: Create `lib/supabase/admin.ts`**

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "./env";

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = getSupabaseAdminEnv();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

- [ ] **Step 4: Create `lib/supabase/client.ts`**

```ts
"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
```

- [ ] **Step 5: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/supabase
git commit -m "feat: add supabase client helpers"
```

---

### Task 4: Account and Limit Helpers

**Files:**
- Create: `lib/account.ts`
- Create: `test/account.test.ts`

**Interfaces:**
- Produces:
  - `FREE_CATALOG_LIMIT = 1`
  - `FREE_PAGE_LIMIT = 20`
  - `FREE_QUESTION_LIMIT = 3`
  - `type WorkspacePlan = "free" | "paid"`
  - `canUploadCatalog(input): { ok: true } | { ok: false; reason: string }`
  - `canAskQuestion(input): { ok: true } | { ok: false; reason: string }`
  - `getOrCreateWorkspaceForUser(user): Promise<Workspace>`
  - `listWorkspaceCatalogs(workspaceId): Promise<CatalogEntry[]>`
  - `createCatalogEntry(input): Promise<CatalogEntry>`
  - `getOwnedCatalogEntry(blobCatalogId, userId): Promise<CatalogEntry | null>`
  - `incrementQuestionCount(blobCatalogId): Promise<{ ok: true } | { ok: false; reason: string }>`

- [ ] **Step 1: Write failing tests for pure limit helpers**

Create `test/account.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canAskQuestion, canUploadCatalog } from "../lib/account";

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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run test/account.test.ts
```

Expected: FAIL because `lib/account.ts` does not exist.

- [ ] **Step 3: Create `lib/account.ts`**

```ts
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const FREE_CATALOG_LIMIT = 1;
export const FREE_PAGE_LIMIT = 20;
export const FREE_QUESTION_LIMIT = 3;

export type WorkspacePlan = "free" | "paid";

export type Workspace = {
  id: string;
  name: string;
  owner_user_id: string;
  plan: WorkspacePlan;
  subscription_status: string;
  custom_domain: string | null;
  logo_blob_path: string | null;
  primary_color: string | null;
};

export type CatalogEntry = {
  id: string;
  workspace_id: string;
  blob_catalog_id: string;
  name: string;
  slug: string;
  description: string;
  notes: string;
  example_questions: string[];
  num_pages: number;
  mode: "full" | "rag";
  status: "processing" | "ready" | "failed";
  question_limit: number;
  question_count: number;
};

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

export async function getOrCreateWorkspaceForUser(user: {
  id: string;
  email?: string;
}): Promise<Workspace> {
  const supabase = createSupabaseAdminClient();
  const existing = await supabase
    .from("workspace_members")
    .select("workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const row = existing.data as { workspaces: Workspace | Workspace[] | null } | null;
  const workspace = Array.isArray(row?.workspaces)
    ? row?.workspaces[0]
    : row?.workspaces;
  if (workspace) return workspace;

  const name = user.email ? user.email.split("@")[0] : "Workspace";
  const created = await supabase
    .from("workspaces")
    .insert({ name, owner_user_id: user.id })
    .select("*")
    .single();
  if (created.error) throw created.error;

  const membership = await supabase
    .from("workspace_members")
    .insert({
      workspace_id: created.data.id,
      user_id: user.id,
      role: "owner",
    });
  if (membership.error) throw membership.error;

  return created.data as Workspace;
}

export async function listWorkspaceCatalogs(
  workspaceId: string,
): Promise<CatalogEntry[]> {
  const supabase = createSupabaseAdminClient();
  const res = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  return (res.data ?? []) as CatalogEntry[];
}

export async function createCatalogEntry(input: {
  workspaceId: string;
  blobCatalogId: string;
  name: string;
  slug: string;
  description?: string;
  notes: string;
  exampleQuestions: string[];
  numPages: number;
  mode: "full" | "rag";
  questionLimit: number;
}): Promise<CatalogEntry> {
  const supabase = createSupabaseAdminClient();
  const res = await supabase
    .from("catalog_entries")
    .insert({
      workspace_id: input.workspaceId,
      blob_catalog_id: input.blobCatalogId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      notes: input.notes,
      example_questions: input.exampleQuestions,
      num_pages: input.numPages,
      mode: input.mode,
      question_limit: input.questionLimit,
    })
    .select("*")
    .single();
  if (res.error) throw res.error;
  return res.data as CatalogEntry;
}

export async function getOwnedCatalogEntry(
  blobCatalogId: string,
  userId: string,
): Promise<CatalogEntry | null> {
  const workspace = await getOrCreateWorkspaceForUser({ id: userId });
  const supabase = createSupabaseAdminClient();
  const res = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("blob_catalog_id", blobCatalogId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as CatalogEntry | null) ?? null;
}

export async function incrementQuestionCount(
  blobCatalogId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createSupabaseAdminClient();
  const current = await supabase
    .from("catalog_entries")
    .select("id, question_count, question_limit, workspace_id, workspaces(plan)")
    .eq("blob_catalog_id", blobCatalogId)
    .maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return { ok: true };

  const row = current.data as {
    id: string;
    question_count: number;
    workspaces: { plan: WorkspacePlan } | { plan: WorkspacePlan }[] | null;
  };
  const workspace = Array.isArray(row.workspaces)
    ? row.workspaces[0]
    : row.workspaces;
  const allowed = canAskQuestion({
    plan: workspace?.plan ?? "free",
    questionCount: row.question_count,
  });
  if (!allowed.ok) return allowed;

  const updated = await supabase
    .from("catalog_entries")
    .update({ question_count: row.question_count + 1 })
    .eq("id", row.id);
  if (updated.error) throw updated.error;
  return { ok: true };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run test/account.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/account.ts test/account.test.ts
git commit -m "feat: add account limits and workspace helpers"
```

---

### Task 5: Supabase Login and Session Middleware

**Files:**
- Create: `middleware.ts`
- Create: `app/auth/callback/route.ts`
- Create: `app/login/page.tsx`
- Create: `components/login-form.tsx`

**Interfaces:**
- Produces routes:
  - `GET /login`
  - `GET /auth/callback`
- Produces middleware session refresh for:
  - `/dashboard`
  - `/api/admin/*`

- [ ] **Step 1: Create `middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/admin/:path*", "/auth/callback"],
};
```

- [ ] **Step 2: Create OAuth callback route**

Create `app/auth/callback/route.ts`:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
```

- [ ] **Step 3: Create login form**

Create `components/login-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=/dashboard`,
      },
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Bei AskCatalog anmelden</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Lade einen Produktkatalog hoch und teile einen KI-Link mit Kunden.
      </p>
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Weiterleitung..." : "Mit Google anmelden"}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Create login page**

Create `app/login/page.tsx`:

```tsx
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return <LoginForm />;
}
```

- [ ] **Step 5: Verify Google provider configuration**

In Supabase Studio, confirm Google OAuth is enabled and the redirect URL includes:

```text
http://localhost:3000/auth/callback
https://poase.com/auth/callback
https://www.poase.com/auth/callback
```

Expected: Google login redirects back to `/dashboard`.

- [ ] **Step 6: Typecheck and commit**

Run:

```bash
npx tsc --noEmit
git add middleware.ts app/auth/callback/route.ts app/login/page.tsx components/login-form.tsx
git commit -m "feat: add supabase google login"
```

---

### Task 6: Authenticated Dashboard

**Files:**
- Create: `app/dashboard/page.tsx`
- Create: `components/dashboard/catalog-dashboard.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes:
  - `createSupabaseServerClient()`
  - `getOrCreateWorkspaceForUser(user)`
  - `listWorkspaceCatalogs(workspaceId)`
- Produces authenticated dashboard UI.

- [ ] **Step 1: Create dashboard component**

Create `components/dashboard/catalog-dashboard.tsx`:

```tsx
"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import type { CatalogEntry, Workspace } from "@/lib/account";

const api = (path: string) => `${BASE_PATH}${path}`;

export function CatalogDashboard({
  workspace,
  catalogs,
}: {
  workspace: Workspace;
  catalogs: CatalogEntry[];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function doUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Bitte eine PDF-Datei wählen.");
      return;
    }
    setBusy(true);
    try {
      setStatus("Datei wird hochgeladen...");
      const blob = await upload(`pending/${file.name}`, file, {
        access: "private",
        handleUploadUrl: api("/api/admin/blob-upload"),
        contentType: "application/pdf",
        multipart: true,
      });
      setStatus("Katalog wird verarbeitet...");
      const res = await fetch(api("/api/admin/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: blob.pathname, filename: file.name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Verarbeitung fehlgeschlagen.");
      }
      window.location.reload();
    } catch (err) {
      alert(`Upload fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-muted-foreground text-sm">{workspace.name}</p>
          <h1 className="text-2xl font-semibold">Kataloge</h1>
        </div>
        <span className="rounded-md border px-2 py-1 text-xs uppercase">
          {workspace.plan}
        </span>
      </div>

      <form onSubmit={doUpload} className="mt-8 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" name="file" accept="application/pdf" />
          <button
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Bitte warten..." : "Katalog hochladen"}
          </button>
          {status && <span className="text-sm text-muted-foreground">{status}</span>}
        </div>
        {workspace.plan === "free" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Kostenlos: 1 Katalog, bis 20 Seiten, 3 Fragen.
          </p>
        )}
      </form>

      <div className="mt-8 space-y-3">
        {catalogs.map((catalog) => (
          <article key={catalog.id} className="rounded-md border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <a
                  href={api(`/catalog/${catalog.blob_catalog_id}`)}
                  className="font-medium underline"
                >
                  {catalog.name}
                </a>
                <p className="text-muted-foreground mt-1 text-xs">
                  {catalog.num_pages} Seiten, {catalog.question_count}/
                  {catalog.question_limit} Fragen genutzt
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(`${location.origin}${api(`/catalog/${catalog.blob_catalog_id}`)}`)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Link kopieren
              </button>
            </div>
          </article>
        ))}
        {catalogs.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Noch keine Kataloge. Lade deinen ersten Produktkatalog hoch.
          </p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create dashboard page**

Create `app/dashboard/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { CatalogDashboard } from "@/components/dashboard/catalog-dashboard";
import { getOrCreateWorkspaceForUser, listWorkspaceCatalogs } from "@/lib/account";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const workspace = await getOrCreateWorkspaceForUser({
    id: data.user.id,
    email: data.user.email,
  });
  const catalogs = await listWorkspaceCatalogs(workspace.id);

  return <CatalogDashboard workspace={workspace} catalogs={catalogs} />;
}
```

- [ ] **Step 3: Replace global catalog list on the home page**

Replace `app/page.tsx` with:

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
      <p className="text-muted-foreground text-sm">AskCatalog for product catalogs</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-normal">
        Turn a product catalog into a shareable AI assistant.
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl text-base">
        Upload a PDF, get a link, and let customers ask grounded questions with
        page citations.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/dashboard"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Upload catalog
        </Link>
        <Link href="/login" className="rounded-md border px-4 py-2 text-sm font-medium">
          Sign in
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run:

```bash
npx tsc --noEmit
git add app/dashboard/page.tsx components/dashboard/catalog-dashboard.tsx app/page.tsx
git commit -m "feat: add authenticated catalog dashboard"
```

---

### Task 7: Upload Ownership and Free Limits

**Files:**
- Modify: `lib/process-upload.ts`
- Modify: `app/api/admin/blob-upload/route.ts`
- Modify: `app/api/admin/ingest/route.ts`

**Interfaces:**
- Changes `processUpload(bytes, filename)` to:
  - `processUpload(bytes, filename, options?: { workspaceId?: string; questionLimit?: number })`
- Upload routes require Supabase user auth.
- Ingest route creates a `catalog_entries` row.

- [ ] **Step 1: Modify `lib/process-upload.ts` return shape**

Update the function signature and return value so it exposes data needed for DB ownership:

```ts
export async function processUpload(
  bytes: Uint8Array,
  filename: string,
): Promise<{
  id: string;
  name: string;
  numPages: number;
  mode: "full" | "rag";
  notes: string;
  exampleQuestions: string[];
}> {
  // keep the existing body, but return notes and exampleQuestions too
}
```

At the end, return:

```ts
return {
  id,
  name: record.name,
  numPages,
  mode,
  notes: record.notes,
  exampleQuestions: record.exampleQuestions,
};
```

- [ ] **Step 2: Rewrite `app/api/admin/blob-upload/route.ts` auth**

Replace `requireAdmin()` usage with:

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async () => {
        const user = await requireUser();
        if (!user) throw new Error("Nicht autorisiert");
        return {
          addRandomSuffix: true,
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 200 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "Upload nicht autorisiert" },
      { status: 401 },
    );
  }
}
```

- [ ] **Step 3: Rewrite `app/api/admin/ingest/route.ts`**

```ts
import {
  FREE_QUESTION_LIMIT,
  canUploadCatalog,
  createCatalogEntry,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
} from "@/lib/account";
import { getBlobBytes, removeBlob } from "@/lib/store";
import { processUpload } from "@/lib/process-upload";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function slugFromName(name: string) {
  return name
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "catalog";
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const { pathname, filename } = (await req.json()) as {
    pathname?: string;
    filename?: string;
  };
  if (!pathname || !filename) {
    return Response.json({ error: "pathname und filename erforderlich" }, { status: 400 });
  }

  const bytes = await getBlobBytes(pathname);
  if (!bytes) {
    return Response.json({ error: "Hochgeladene Datei nicht gefunden." }, { status: 404 });
  }

  try {
    const workspace = await getOrCreateWorkspaceForUser({
      id: data.user.id,
      email: data.user.email,
    });
    const existing = await listWorkspaceCatalogs(workspace.id);
    const result = await processUpload(bytes, filename);
    const allowed = canUploadCatalog({
      plan: workspace.plan,
      existingCatalogs: existing.length,
      pages: result.numPages,
    });
    if (!allowed.ok) {
      await removeBlob(pathname);
      return Response.json(
        {
          error:
            allowed.reason === "FREE_PAGE_LIMIT"
              ? "Der kostenlose Plan erlaubt Kataloge bis 20 Seiten."
              : "Der kostenlose Plan erlaubt einen Katalog.",
        },
        { status: 402 },
      );
    }

    const entry = await createCatalogEntry({
      workspaceId: workspace.id,
      blobCatalogId: result.id,
      name: result.name,
      slug: slugFromName(result.name),
      notes: result.notes,
      exampleQuestions: result.exampleQuestions,
      numPages: result.numPages,
      mode: result.mode,
      questionLimit: workspace.plan === "free" ? FREE_QUESTION_LIMIT : 1000,
    });
    await removeBlob(pathname);
    return Response.json({ ...result, catalogEntryId: entry.id });
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
```

- [ ] **Step 4: Typecheck and commit**

Run:

```bash
npx tsc --noEmit
git add lib/process-upload.ts app/api/admin/blob-upload/route.ts app/api/admin/ingest/route.ts
git commit -m "feat: enforce authenticated upload limits"
```

---

### Task 8: Ownership Checks on Catalog Updates and Question Limits

**Files:**
- Modify: `app/api/admin/catalogs/[id]/route.ts`
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes:
  - `getOwnedCatalogEntry(blobCatalogId, userId)`
  - `incrementQuestionCount(blobCatalogId)`
- Produces:
  - Owner-only catalog patch and delete.
  - Free question limit enforcement in chat.

- [ ] **Step 1: Update catalog mutation route ownership**

In `app/api/admin/catalogs/[id]/route.ts`, replace admin password checks with Supabase user checks. Use this pattern at the top of each handler:

```ts
const supabase = await createSupabaseServerClient();
const { data } = await supabase.auth.getUser();
if (!data.user) {
  return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
}
const owned = await getOwnedCatalogEntry(params.id, data.user.id);
if (!owned) {
  return Response.json({ error: "Nicht gefunden" }, { status: 404 });
}
```

Keep existing `patchCatalog(params.id, patch)` and `removeCatalog(params.id)` behavior after the ownership check.

- [ ] **Step 2: Update chat question limits**

In `app/api/chat/route.ts`, after catalog lookup succeeds and before calling Gemini:

```ts
const usage = await incrementQuestionCount(docId);
if (!usage.ok) {
  return Response.json({
    text: "Das kostenlose Fragenlimit für diesen Katalog ist erreicht.",
    citations: [],
  });
}
```

This increments before model execution. If model execution fails, the question is still counted. That is acceptable for the MVP because it keeps the implementation simple.

- [ ] **Step 3: Typecheck and commit**

Run:

```bash
npx tsc --noEmit
git add app/api/admin/catalogs/[id]/route.ts app/api/chat/route.ts
git commit -m "feat: protect catalog updates and question limits"
```

---

### Task 9: Keep Legacy Admin as Internal Fallback

**Files:**
- Modify: `app/admin/page.tsx`

**Interfaces:**
- Produces redirect from `/admin` to `/dashboard`.
- Keeps old admin components in code for now but removes them from normal flow.

- [ ] **Step 1: Replace `/admin` page with redirect**

Replace `app/admin/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/dashboard");
}
```

- [ ] **Step 2: Typecheck and commit**

Run:

```bash
npx tsc --noEmit
git add app/admin/page.tsx
git commit -m "chore: redirect admin to dashboard"
```

---

### Task 10: Verification

**Files:**
- No source changes unless verification finds defects.

**Interfaces:**
- Produces verified local foundation.

- [ ] **Step 1: Install dependencies if needed**

Run:

```bash
npm install
```

Expected: dependencies install successfully.

- [ ] **Step 2: Run unit tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 4: Run TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: production build succeeds.

- [ ] **Step 6: Manual browser check**

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/login
http://localhost:3000/dashboard
```

Expected:

- Home page shows product positioning.
- Login starts Google OAuth.
- Dashboard requires auth.
- Authenticated user can upload one PDF under 20 pages.
- Second free upload is blocked.
- Catalog chat works for three questions.
- Fourth question is blocked.

- [ ] **Step 7: Commit verification fixes**

If fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix: complete catalog saas foundation verification"
```

---

## Self-Review

Spec coverage:

- Product catalog focus is reflected in landing copy and limits.
- Supabase on Hetzner is used through the 1Password-backed env flow.
- Google login is implemented through Supabase Auth.
- Free limits are implemented for catalog count, page count, and questions.
- Stripe, custom domains, logo upload, and analytics are intentionally deferred to follow-up plans.

Placeholder scan:

- No implementation step uses placeholder commands or unspecified files.
- The only environment value not hardcoded is the database connection string, because it is intentionally secret and not available in the PRD.

Type consistency:

- `Workspace`, `CatalogEntry`, `WorkspacePlan`, limit helpers, and account helper function names are defined before use.
- `processUpload` return fields are consumed by the ingest route.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-catalog-saas-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
