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
