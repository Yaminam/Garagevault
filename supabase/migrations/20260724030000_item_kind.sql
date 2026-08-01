-- Give the database enough shape to serve the four sections.
--
-- Deliberately NOT four tables with real columns. Splitting billing and assets
-- into plaintext tables would mean Postgres holding vendor names, serial
-- numbers, owner emails and amounts in the clear, which undoes the reason the
-- vault exists. Everything stays in `ciphertext`.
--
-- What is added is a single non-secret discriminator, so the app can fetch just
-- the assets instead of pulling and decrypting every row to find them. The
-- honest cost: an observer with the public anon key learns how many entries of
-- each kind exist. Not what they are, who they belong to, or anything inside
-- them. That is a fair trade for being able to page a growing table; if it ever
-- is not, drop the column and filter after decryption instead.

alter table public.vault_items
  add column if not exists kind text
    check (kind is null or kind in ('login', 'env', 'billing', 'asset'));

-- Existing rows predate the column. They cannot be backfilled here, because
-- their kind is inside the ciphertext and the server has no key. The app fills
-- them in on first unlock, and `null` simply means "not yet known".
create index if not exists vault_items_kind_idx
  on public.vault_items (kind, updated_at desc);

comment on column public.vault_items.kind is
  'Non-secret discriminator so sections can be queried without decrypting. Never put anything identifying here.';
