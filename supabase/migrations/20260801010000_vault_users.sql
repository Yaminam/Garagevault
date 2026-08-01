-- More than one password can open the vault.
--
-- Each row here is one accepted password. It holds a copy of the vault key
-- sealed under that password, so adding or removing a person rewrites one
-- small record and re-encrypts nothing: the key the rows were written with
-- never changes.
--
-- The table deliberately holds no email, no name and no handle to look a
-- person up by. A membership list is worth something on its own, and a
-- database that cannot read a single entry should not also be able to say who
-- has access. Unlocking derives one key from whatever was typed and tries it
-- against each row; the AES-GCM tag decides which one matched, and a row that
-- does not match reveals nothing about what it holds.
--
-- The person's name and email live in `profile_ct`, sealed under the same
-- password, so they only become readable to whoever already opened the vault.

create table if not exists public.vault_users (
  id uuid primary key default gen_random_uuid(),

  -- The vault key, sealed under the key derived from this password.
  key_iv text not null,
  key_ct text not null,

  -- { name, email } for the person, sealed under the same derived key.
  -- Null for a password that belongs to no one in particular, such as a
  -- shared admin password.
  profile_iv text,
  profile_ct text,

  -- Free-text reminder of which password this is, for the operator running
  -- the tools. Never a hint at the password itself.
  label text,

  created_at timestamptz not null default now()
);

alter table public.vault_users enable row level security;

-- The same trade the other tables make, documented in the README: the anon key
-- is public by design, so these policies gate shape rather than identity.
-- Confidentiality comes from the sealing, not from these rules.
drop policy if exists vault_users_select on public.vault_users;
create policy vault_users_select on public.vault_users
  for select to anon, authenticated using (true);

drop policy if exists vault_users_insert on public.vault_users;
create policy vault_users_insert on public.vault_users
  for insert to anon, authenticated with check (true);

drop policy if exists vault_users_delete on public.vault_users;
create policy vault_users_delete on public.vault_users
  for delete to anon, authenticated using (true);
