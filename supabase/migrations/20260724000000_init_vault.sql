-- Garage Vault schema
--
-- Applied with:  npm run db:push
--
-- Design note. The anon key the browser ships is public. Anyone who opens the
-- app can read it, so it cannot be the thing that protects the data. The
-- protection is that every secret column is AES-256-GCM ciphertext, encrypted
-- in the browser. Postgres only ever sees opaque blobs, and the policies below
-- grant access to those blobs on purpose.

create extension if not exists pgcrypto;

-- ============================================================== vault_meta ==
-- Exactly one row. Holds the KDF parameters plus a verifier blob, which lets
-- the app tell "wrong master password" apart from "corrupt data" without
-- touching a real credential.

create table if not exists public.vault_meta (
  id              smallint primary key default 1 check (id = 1),
  kdf_salt        text        not null,
  kdf_iterations  integer     not null default 600000 check (kdf_iterations >= 100000),
  verifier_iv     text        not null,
  verifier_ct     text        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================= vault_items ==
-- One row per credential or environment file. Every field lives inside
-- `ciphertext`, including the title, so the database leaks no metadata.

create table if not exists public.vault_items (
  id          uuid        primary key default gen_random_uuid(),
  iv          text        not null check (length(iv) between 8 and 64),
  ciphertext  text        not null check (length(ciphertext) between 16 and 262144),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists vault_items_updated_at_idx
  on public.vault_items (updated_at desc);

-- ============================================================ vault_shares ==
-- One-time secret links. The payload is encrypted with a random key that lives
-- only in the URL fragment, which browsers never transmit. So this table is
-- unreadable even to someone holding the service_role key: a share is only
-- openable by whoever holds the full link.

create table if not exists public.vault_shares (
  id          uuid        primary key default gen_random_uuid(),
  iv          text        not null check (length(iv) between 8 and 64),
  ciphertext  text        not null check (length(ciphertext) between 16 and 262144),
  -- Non-secret hint shown before opening, for example "Supabase .env".
  label       text        check (label is null or length(label) <= 120),
  expires_at  timestamptz not null,
  max_views   integer     not null default 1 check (max_views between 1 and 50),
  views       integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists vault_shares_expires_at_idx
  on public.vault_shares (expires_at);

-- =================================================================== rules ==

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vault_items_touch on public.vault_items;
create trigger vault_items_touch
  before update on public.vault_items
  for each row execute function public.touch_updated_at();

drop trigger if exists vault_meta_touch on public.vault_meta;
create trigger vault_meta_touch
  before update on public.vault_meta
  for each row execute function public.touch_updated_at();

-- Claiming a share is the only way to read one. It counts the view, drops the
-- row once the budget is spent, and refuses anything expired. Running as
-- SECURITY DEFINER means the table itself stays unreadable to clients.
create or replace function public.claim_share(p_id uuid)
returns table (iv text, ciphertext text, label text, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.vault_shares%rowtype;
begin
  delete from public.vault_shares where expires_at < now();

  select * into rec from public.vault_shares where id = p_id for update;
  if not found then
    return;
  end if;

  if rec.views >= rec.max_views then
    delete from public.vault_shares where id = p_id;
    return;
  end if;

  update public.vault_shares
     set views = views + 1
   where id = p_id
  returning * into rec;

  iv         := rec.iv;
  ciphertext := rec.ciphertext;
  label      := rec.label;
  views_left := rec.max_views - rec.views;
  return next;

  if rec.views >= rec.max_views then
    delete from public.vault_shares where id = p_id;
  end if;
end;
$$;

revoke all on function public.claim_share(uuid) from public;
grant execute on function public.claim_share(uuid) to anon, authenticated;

-- ===================================================================== rls ==

alter table public.vault_meta   enable row level security;
alter table public.vault_items  enable row level security;
alter table public.vault_shares enable row level security;

drop policy if exists vault_meta_select on public.vault_meta;
drop policy if exists vault_meta_insert on public.vault_meta;
drop policy if exists vault_meta_update on public.vault_meta;

create policy vault_meta_select on public.vault_meta
  for select to anon, authenticated using (true);
create policy vault_meta_insert on public.vault_meta
  for insert to anon, authenticated with check (true);
create policy vault_meta_update on public.vault_meta
  for update to anon, authenticated using (true) with check (true);

drop policy if exists vault_items_select on public.vault_items;
drop policy if exists vault_items_insert on public.vault_items;
drop policy if exists vault_items_update on public.vault_items;
drop policy if exists vault_items_delete on public.vault_items;

create policy vault_items_select on public.vault_items
  for select to anon, authenticated using (true);
create policy vault_items_insert on public.vault_items
  for insert to anon, authenticated with check (true);
create policy vault_items_update on public.vault_items
  for update to anon, authenticated using (true) with check (true);
create policy vault_items_delete on public.vault_items
  for delete to anon, authenticated using (true);

-- Shares are write-only from the client. Reading goes through claim_share.
drop policy if exists vault_shares_insert on public.vault_shares;
create policy vault_shares_insert on public.vault_shares
  for insert to anon, authenticated with check (
    expires_at > now() and expires_at < now() + interval '30 days'
  );

-- =============================================================== hardening ==
--
-- The policies above keep every secret confidential but leave rows open to
-- deletion by anyone holding the public anon key. For an internal tool on a
-- private URL that is usually an acceptable trade. To close it, turn on
-- Supabase Auth, invite only your team, and change `to anon, authenticated`
-- to `to authenticated` on the insert, update and delete policies.
