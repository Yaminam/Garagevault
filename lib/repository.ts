/**
 * Data access for the vault.
 *
 * Every function here deals in ciphertext at the wire and plaintext at the API
 * boundary. Encryption happens on the way out, decryption on the way in, so no
 * caller ever has to remember to seal something.
 */

import { DecryptionError, open, seal, type Sealed } from './crypto.ts';
import type { Client } from './supabase.ts';
import type { EncryptedRow, ItemFields, VaultItem, VaultMeta } from './types.ts';

export class SchemaMissingError extends Error {
  constructor() {
    super('The vault tables do not exist yet. Run supabase/schema.sql in the Supabase SQL editor.');
    this.name = 'SchemaMissingError';
  }
}

/** Postgres codes that mean "the table is not there", as surfaced by PostgREST. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|schema cache/i.test(error.message ?? '')
  );
}

/* ----------------------------------------------------------------- meta ---- */

export async function fetchMeta(client: Client): Promise<VaultMeta | null> {
  const { data, error } = await client
    .from('vault_meta')
    .select('kdf_salt, kdf_iterations, verifier_iv, verifier_ct')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) throw new SchemaMissingError();
    throw new Error(error.message);
  }
  if (!data) return null;

  return {
    kdfSalt: data.kdf_salt,
    kdfIterations: data.kdf_iterations,
    verifierIv: data.verifier_iv,
    verifierCt: data.verifier_ct,
  };
}

export async function writeMeta(client: Client, meta: VaultMeta): Promise<void> {
  const { error } = await client.from('vault_meta').upsert(
    {
      id: 1,
      kdf_salt: meta.kdfSalt,
      kdf_iterations: meta.kdfIterations,
      verifier_iv: meta.verifierIv,
      verifier_ct: meta.verifierCt,
    },
    { onConflict: 'id' },
  );

  if (error) {
    if (isMissingTable(error)) throw new SchemaMissingError();
    throw new Error(error.message);
  }
}

/* ---------------------------------------------------------------- items ---- */

function toItem(row: EncryptedRow, fields: ItemFields): VaultItem {
  return { ...fields, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export type LoadResult = {
  items: VaultItem[];
  /** Rows the current key could not open. Non-zero means mixed master passwords. */
  unreadable: number;
};

export async function loadItems(client: Client, key: CryptoKey): Promise<LoadResult> {
  const { data, error } = await client
    .from('vault_items')
    .select('id, iv, ciphertext, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingTable(error)) throw new SchemaMissingError();
    throw new Error(error.message);
  }

  const items: VaultItem[] = [];
  let unreadable = 0;

  for (const row of (data ?? []) as EncryptedRow[]) {
    try {
      const fields = await open<ItemFields>(key, { iv: row.iv, ciphertext: row.ciphertext });
      items.push(toItem(row, fields));
    } catch (err) {
      if (err instanceof DecryptionError) unreadable++;
      else throw err;
    }
  }

  items.sort((a, b) => a.title.localeCompare(b.title));
  return { items, unreadable };
}

export async function insertItem(
  client: Client,
  key: CryptoKey,
  fields: ItemFields,
): Promise<VaultItem> {
  const sealed = await seal(key, fields);
  const { data, error } = await client
    .from('vault_items')
    // `kind` is the only thing stored outside the ciphertext, so sections can
    // be queried without decrypting every row. Nothing identifying goes here.
    .insert({ iv: sealed.iv, ciphertext: sealed.ciphertext, kind: fields.kind })
    .select('id, iv, ciphertext, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);
  return toItem(data as EncryptedRow, fields);
}

/**
 * Fill in `kind` for rows written before the column existed.
 *
 * The server cannot do this: the kind lives inside the ciphertext. So it runs
 * once after unlock, best effort, and a failure is not worth surfacing since
 * the app reads kind from the decrypted payload anyway.
 */
export async function backfillKinds(client: Client, items: VaultItem[]): Promise<number> {
  if (items.length === 0) return 0;

  const byKind = new Map<string, string[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item.id);
    byKind.set(item.kind, list);
  }

  let updated = 0;
  for (const [kind, ids] of byKind) {
    const { error, count } = await client
      .from('vault_items')
      .update({ kind }, { count: 'exact' })
      .in('id', ids)
      .is('kind', null);
    if (!error) updated += count ?? 0;
  }
  return updated;
}

export async function updateItem(
  client: Client,
  key: CryptoKey,
  id: string,
  fields: ItemFields,
): Promise<VaultItem> {
  const sealed = await seal(key, fields);
  const { data, error } = await client
    .from('vault_items')
    .update({ iv: sealed.iv, ciphertext: sealed.ciphertext, kind: fields.kind })
    .eq('id', id)
    .select('id, iv, ciphertext, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);
  return toItem(data as EncryptedRow, fields);
}

export async function deleteItem(client: Client, id: string): Promise<void> {
  const { error } = await client.from('vault_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Bulk insert, used by the seeding tool. */
export async function insertMany(
  client: Client,
  key: CryptoKey,
  batch: ItemFields[],
): Promise<number> {
  const rows: (Sealed & { kind: string })[] = [];
  for (const fields of batch) rows.push({ ...(await seal(key, fields)), kind: fields.kind });

  const { error, count } = await client
    .from('vault_items')
    .insert(
      rows.map((r) => ({ iv: r.iv, ciphertext: r.ciphertext, kind: r.kind })),
      { count: 'exact' },
    );

  if (error) {
    if (isMissingTable(error)) throw new SchemaMissingError();
    throw new Error(error.message);
  }
  return count ?? batch.length;
}
