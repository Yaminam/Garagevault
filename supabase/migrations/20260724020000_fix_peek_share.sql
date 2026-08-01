-- Fix an ambiguous column reference in peek_share.
--
-- `returns table (... expires_at timestamptz ...)` declares expires_at as an OUT
-- variable, so the unqualified `where expires_at < now()` in the housekeeping
-- delete matched both the variable and the column. Postgres refuses that rather
-- than guessing. Every reference to the table is now alias qualified.

create or replace function public.peek_share(p_id uuid)
returns table (label text, recipient_hint text, expires_at timestamptz, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vault_shares s where s.expires_at < now();

  return query
  select s.label, s.recipient_hint, s.expires_at, s.max_views - s.views
    from public.vault_shares s
   where s.id = p_id
     and s.expires_at >= now()
     and s.views < s.max_views;
end;
$$;

revoke all on function public.peek_share(uuid) from public;
grant execute on function public.peek_share(uuid) to anon, authenticated;

-- claim_share has the same housekeeping delete. It is not ambiguous there,
-- since expires_at is not one of its OUT parameters, but qualify it anyway so
-- the two functions cannot drift.
create or replace function public.claim_share(p_id uuid)
returns table (iv text, ciphertext text, label text, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.vault_shares%rowtype;
begin
  delete from public.vault_shares s where s.expires_at < now();

  select * into rec from public.vault_shares s where s.id = p_id for update;
  if not found then
    return;
  end if;

  if rec.views >= rec.max_views then
    delete from public.vault_shares s where s.id = p_id;
    return;
  end if;

  update public.vault_shares s
     set views = s.views + 1
   where s.id = p_id
  returning * into rec;

  iv         := rec.iv;
  ciphertext := rec.ciphertext;
  label      := rec.label;
  views_left := rec.max_views - rec.views;
  return next;

  if rec.views >= rec.max_views then
    delete from public.vault_shares s where s.id = p_id;
  end if;
end;
$$;

revoke all on function public.claim_share(uuid) from public;
grant execute on function public.claim_share(uuid) to anon, authenticated;
