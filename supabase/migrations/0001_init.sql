-- Web-to-Book Reader: initial schema (MVP)

-- Extensions
create extension if not exists pgcrypto;

-- Helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.normalize_url(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(trim(input), '/+$', '');
$$;

create or replace function public.url_hash(input text)
returns text
language sql
immutable
as $$
  select encode(digest(public.normalize_url(input), 'sha256'), 'hex');
$$;

-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  avatar_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- auto create profile row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- articles
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  url_hash text not null,
  title text,
  site_name text,
  cover_image_url text,
  author text,
  published_at timestamptz,
  excerpt text,
  lang text,
  content_json jsonb,
  content_text text,
  content_html text,
  status text not null default 'unread',
  extract_status text not null default 'queued',
  extract_error text,
  extract_debug jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists articles_user_url_hash_uq on public.articles (user_id, url_hash);
create index if not exists articles_user_status_updated_idx on public.articles (user_id, status, updated_at desc);

create or replace function public.articles_set_hash()
returns trigger
language plpgsql
as $$
begin
  new.url_hash = public.url_hash(new.url);
  return new;
end;
$$;

drop trigger if exists articles_set_hash on public.articles;
create trigger articles_set_hash
before insert or update of url on public.articles
for each row execute function public.articles_set_hash();

drop trigger if exists articles_set_updated_at on public.articles;
create trigger articles_set_updated_at
before update on public.articles
for each row execute function public.set_updated_at();

-- reading_progress
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  current_page int not null default 0,
  total_pages int not null default 0,
  progress_anchor jsonb,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

drop trigger if exists reading_progress_set_updated_at on public.reading_progress;
create trigger reading_progress_set_updated_at
before update on public.reading_progress
for each row execute function public.set_updated_at();

-- collections
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color_code text,
  created_at timestamptz not null default now()
);

-- article_collections
create table if not exists public.article_collections (
  article_id uuid not null references public.articles (id) on delete cascade,
  collection_id uuid not null references public.collections (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, collection_id)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.articles enable row level security;
alter table public.reading_progress enable row level security;
alter table public.collections enable row level security;
alter table public.article_collections enable row level security;

-- Policies: profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- Policies: articles
drop policy if exists "articles_select_own" on public.articles;
create policy "articles_select_own"
on public.articles for select
using (user_id = auth.uid());

drop policy if exists "articles_insert_own" on public.articles;
create policy "articles_insert_own"
on public.articles for insert
with check (user_id = auth.uid());

drop policy if exists "articles_update_own" on public.articles;
create policy "articles_update_own"
on public.articles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "articles_delete_own" on public.articles;
create policy "articles_delete_own"
on public.articles for delete
using (user_id = auth.uid());

-- Policies: reading_progress
drop policy if exists "progress_select_own" on public.reading_progress;
create policy "progress_select_own"
on public.reading_progress for select
using (user_id = auth.uid());

drop policy if exists "progress_upsert_own" on public.reading_progress;
create policy "progress_upsert_own"
on public.reading_progress for insert
with check (user_id = auth.uid());

drop policy if exists "progress_update_own" on public.reading_progress;
create policy "progress_update_own"
on public.reading_progress for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "progress_delete_own" on public.reading_progress;
create policy "progress_delete_own"
on public.reading_progress for delete
using (user_id = auth.uid());

-- Policies: collections
drop policy if exists "collections_select_own" on public.collections;
create policy "collections_select_own"
on public.collections for select
using (user_id = auth.uid());

drop policy if exists "collections_insert_own" on public.collections;
create policy "collections_insert_own"
on public.collections for insert
with check (user_id = auth.uid());

drop policy if exists "collections_update_own" on public.collections;
create policy "collections_update_own"
on public.collections for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "collections_delete_own" on public.collections;
create policy "collections_delete_own"
on public.collections for delete
using (user_id = auth.uid());

-- Policies: article_collections
drop policy if exists "article_collections_select_own" on public.article_collections;
create policy "article_collections_select_own"
on public.article_collections for select
using (
  exists (
    select 1
    from public.collections c
    join public.articles a on a.user_id = c.user_id
    where c.id = article_collections.collection_id
      and a.id = article_collections.article_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "article_collections_insert_own" on public.article_collections;
create policy "article_collections_insert_own"
on public.article_collections for insert
with check (
  exists (
    select 1
    from public.collections c
    join public.articles a on a.user_id = c.user_id
    where c.id = article_collections.collection_id
      and a.id = article_collections.article_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "article_collections_delete_own" on public.article_collections;
create policy "article_collections_delete_own"
on public.article_collections for delete
using (
  exists (
    select 1
    from public.collections c
    join public.articles a on a.user_id = c.user_id
    where c.id = article_collections.collection_id
      and a.id = article_collections.article_id
      and c.user_id = auth.uid()
  )
);

