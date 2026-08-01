/**
 * More than one password can open the vault.
 *
 * The vault key itself never changes. It is still the bytes PBKDF2 produces
 * from the original master password, which is why every row written before
 * any of this existed still opens. What each account adds is a second copy of
 * those bytes, sealed under a key derived from that account's own password.
 *
 * Unlocking therefore costs one key derivation, not one per account. The salt
 * and iteration count are shared, so the bytes derived from whatever was typed
 * are simultaneously a candidate vault key, checked against the verifier, and
 * a candidate unwrapping key, tried against each account record. Which one it
 * turns out to be is decided by an AES-GCM tag, not by anything the database
 * knows: a record that does not match simply fails to open and says nothing.
 *
 * A password can carry a profile, in which case opening the vault with it also
 * says who is using the browser and the identity prompt is skipped. A shared
 * password carries none and still asks.
 */

import { DecryptionError, importAesKey, open, seal, unwrapSecret, wrapSecret } from './crypto.ts';
import type { Identity } from './identity.ts';
import type { Client } from './supabase.ts';
import type { VaultMeta } from './types.ts';

const TABLE = 'vault_users';

type Row = {
  id: string;
  key_iv: string;
  key_ct: string;
  profile_iv: string | null;
  profile_ct: string | null;
  label: string | null;
};

export type Unlocked = {
  /** The vault key, identical whichever password opened it. */
  key: CryptoKey;
  /** Who this password belongs to, when it belongs to anyone. */
  identity: Identity | null;
  /** Operator-facing name for the password used. */
  label: string | null;
};

/** True when the table exists but has no rows, or the table is absent. */
export async function listAccounts(client: Client): Promise<Row[]> {
  const { data, error } = await client
    .from(TABLE)
    .select('id,key_iv,key_ct,profile_iv,profile_ct,label')
    .order('created_at', { ascending: true });

  // A vault created before this feature has no such table, which is not an
  // error: it just means the master password is the only way in.
  if (error) return [];
  return (data ?? []) as Row[];
}

/**
 * Try a derived key against every account.
 *
 * `candidate` is the key derived from what the user typed. For an account
 * password it is the unwrapping key; the vault key comes out of the record.
 * The unwrapped bytes are checked against the vault verifier before being
 * trusted, so a record that unwraps to something wrong cannot let a session
 * start with a key that opens nothing.
 */
export async function unlockWithAccount(
  client: Client,
  candidate: CryptoKey,
  meta: VaultMeta,
): Promise<Unlocked | null> {
  const rows = await listAccounts(client);

  for (const row of rows) {
    let raw: ArrayBuffer;
    try {
      raw = await unwrapSecret(candidate, { iv: row.key_iv, ciphertext: row.key_ct });
    } catch {
      continue; // Not this account's password.
    }

    const key = await importAesKey(raw);

    // The record could be stale, from a rekey that did not update it.
    try {
      const check = await open<string>(key, {
        iv: meta.verifierIv,
        ciphertext: meta.verifierCt,
      });
      if (check !== 'garage-vault-verifier-v1') continue;
    } catch {
      continue;
    }

    let identity: Identity | null = null;
    if (row.profile_iv && row.profile_ct) {
      try {
        identity = await open<Identity>(candidate, {
          iv: row.profile_iv,
          ciphertext: row.profile_ct,
        });
      } catch {
        // A readable key with an unreadable profile is odd but not fatal:
        // the vault still opens, the identity prompt just appears.
        identity = null;
      }
    }

    return { key, identity, label: row.label };
  }

  return null;
}

/**
 * Register a password that opens the vault.
 *
 * `vaultKeyBits` is the raw vault key, which the caller gets by deriving it
 * from the master password. `password` is the new one being granted access.
 */
export async function addAccount(
  client: Client,
  vaultKeyBits: ArrayBuffer,
  accountKey: CryptoKey,
  options: { identity: Identity | null; label: string },
): Promise<void> {
  const wrapped = await wrapSecret(accountKey, vaultKeyBits);
  const profile = options.identity ? await seal(accountKey, options.identity) : null;

  const { error } = await client.from(TABLE).insert({
    key_iv: wrapped.iv,
    key_ct: wrapped.ciphertext,
    profile_iv: profile?.iv ?? null,
    profile_ct: profile?.ciphertext ?? null,
    label: options.label,
  });

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      throw new DecryptionError(
        'The vault_users table does not exist yet. Run npm run db:push, then try again.',
      );
    }
    throw new Error(error.message);
  }
}

/** Remove a password's access. The vault key is untouched, so nothing re-encrypts. */
export async function removeAccount(client: Client, id: string): Promise<void> {
  const { error } = await client.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}
