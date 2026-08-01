-- Bind a share to a named recipient.
--
-- The link alone stops being enough: the decryption key is derived from the URL
-- token *and* the recipient's name, so a link leaked into a Slack channel or a
-- forwarded email cannot be opened by whoever finds it.
--
-- Only a masked hint is stored ("A•••• K••"), enough for the right person to
-- know which name is expected and useless to anyone else. The name itself is
-- never stored, not even hashed: it goes straight into the key derivation.

alter table public.vault_shares
  add column if not exists recipient_hint text
    check (recipient_hint is null or length(recipient_hint) <= 120);

-- Reading the hint must not burn a view, so it gets its own function that
-- returns nothing secret.
create or replace function public.peek_share(p_id uuid)
returns table (label text, recipient_hint text, expires_at timestamptz, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vault_shares where expires_at < now();

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
