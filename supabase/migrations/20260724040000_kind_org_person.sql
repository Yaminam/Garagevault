-- Widen vault_items.kind for the organisation kinds.
--
-- The original constraint listed the four kinds that existed at the time. Two
-- more were added in the app (`org` for company details, `person` for
-- employees) and the constraint was not moved with them, so every employee
-- import failed on vault_items_kind_check.
--
-- Worth noting for next time: `kind` is the one column that has to be kept in
-- step with the ItemKind union in lib/types.ts by hand. Adding a kind there
-- means adding it here in the same change.

alter table public.vault_items
  drop constraint if exists vault_items_kind_check;

alter table public.vault_items
  add constraint vault_items_kind_check
  check (kind is null or kind in ('login', 'env', 'billing', 'asset', 'org', 'person'));

comment on column public.vault_items.kind is
  'Non-secret discriminator so sections can be queried without decrypting. Must match the ItemKind union in lib/types.ts. Never put anything identifying here.';
