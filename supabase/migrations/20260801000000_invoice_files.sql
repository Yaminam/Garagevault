-- Encrypted invoice files.
--
-- The bucket holds AES-GCM ciphertext produced in the browser, never the PDF
-- itself. That is the same arrangement the vault_items table has: the storage
-- layer is trusted to hold bytes and nothing more, so a dump of this bucket is
-- a pile of noise without the master password.
--
-- The bucket is private regardless. Public would still only expose ciphertext,
-- but there is no reason to hand it out, and a private bucket means a leaked
-- object name is not a download link.
--
-- Object names are random and carry no vendor, date or amount. The real name
-- of the file lives inside the item's encrypted payload, so even the listing
-- of this bucket leaks nothing about what is in it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vault-files',
  'vault-files',
  false,
  -- 25 MB. An invoice that does not fit is a scan that should have been
  -- compressed, and the cap keeps one bad upload from eating the free tier.
  26214400,
  -- Ciphertext has no meaningful type of its own, so everything is uploaded as
  -- a plain octet stream. Narrowing to that also means a mislabelled upload
  -- cannot smuggle in something the browser would try to render.
  array['application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Same trade the table policies make, and documented in the README: the anon
-- key is public by design, so these policies gate shape rather than identity.
-- Confidentiality comes from the encryption, not from these rules. Turn on
-- Supabase Auth and narrow `to anon, authenticated` to `to authenticated` to
-- close write access.
drop policy if exists vault_files_select on storage.objects;
create policy vault_files_select on storage.objects
  for select to anon, authenticated using (bucket_id = 'vault-files');

drop policy if exists vault_files_insert on storage.objects;
create policy vault_files_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'vault-files');

drop policy if exists vault_files_delete on storage.objects;
create policy vault_files_delete on storage.objects
  for delete to anon, authenticated using (bucket_id = 'vault-files');
