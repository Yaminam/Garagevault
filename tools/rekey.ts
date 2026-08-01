/**
 * Change the master password.
 *
 *   npm run rekey
 *
 * Re-encrypts every row under a key derived from the new password, then swaps
 * the vault metadata. Row ids and timestamps are preserved, so nothing in the
 * vault is lost and no links break.
 *
 * The metadata is written last on purpose: if the run dies partway through, the
 * old password still opens the vault and the job can simply be run again.
 *
 * Set VAULT_MASTER_PASSWORD and VAULT_NEW_PASSWORD to skip the prompts.
 */

import { createInterface } from 'node:readline';
import {
  PBKDF2_ITERATIONS,
  checkVerifier,
  deriveKey,
  makeVerifier,
  randomSalt,
  seal,
} from '../lib/crypto.ts';
import { fetchMeta, loadItems, writeMeta } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import type { ItemFields, VaultMeta } from '../lib/types.ts';

function ask(question: string, silent = false): Promise<string> {
  return new Promise((done) => {
    process.stdout.write(question);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (silent) {
      (rl as unknown as { _writeToOutput: (c: string) => void })._writeToOutput = () => {};
    }
    rl.question('', (answer) => {
      if (silent) process.stdout.write('\n');
      rl.close();
      done(answer.trim());
    });
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  const client = createServerClient(url, key);
  const meta = await fetchMeta(client);
  if (!meta) {
    console.error('No vault exists yet. Run npm run seed first.');
    process.exit(1);
  }

  const oldPassword = process.env.VAULT_MASTER_PASSWORD ?? (await ask('  Current master password: ', true));
  const oldKey = await deriveKey(oldPassword, meta.kdfSalt, meta.kdfIterations);
  if (!(await checkVerifier(oldKey, { iv: meta.verifierIv, ciphertext: meta.verifierCt }))) {
    console.error('\nThat is not the current master password. Nothing was changed.');
    process.exit(1);
  }

  const { items, unreadable } = await loadItems(client, oldKey);
  console.log(`Opened ${items.length} entries${unreadable ? `, ${unreadable} unreadable` : ''}.`);
  if (unreadable > 0) {
    console.error('Some rows use a different key. Re-keying would strand them. Aborting.');
    process.exit(1);
  }

  let newPassword = process.env.VAULT_NEW_PASSWORD ?? '';
  while (!newPassword) {
    const first = await ask('  New master password:     ', true);
    if (first.length < 12) {
      console.log('  Too short. Use at least 12 characters.\n');
      continue;
    }
    const second = await ask('  Confirm:                 ', true);
    if (first !== second) {
      console.log('  Passwords did not match.\n');
      continue;
    }
    newPassword = first;
  }

  const next: VaultMeta = {
    kdfSalt: randomSalt(),
    kdfIterations: PBKDF2_ITERATIONS,
    verifierIv: '',
    verifierCt: '',
  };
  const newKey = await deriveKey(newPassword, next.kdfSalt, next.kdfIterations);
  const verifier = await makeVerifier(newKey);
  next.verifierIv = verifier.iv;
  next.verifierCt = verifier.ciphertext;

  console.log(`\nRe-encrypting ${items.length} entries ...`);
  for (const item of items) {
    const { id, createdAt, updatedAt, ...fields } = item;
    void createdAt;
    void updatedAt;

    const sealed = await seal(newKey, fields as ItemFields);
    const { error } = await client
      .from('vault_items')
      .update({ iv: sealed.iv, ciphertext: sealed.ciphertext })
      .eq('id', id);

    if (error) {
      console.error(`\nFailed on ${item.title}: ${error.message}`);
      console.error('The old password still works. Fix the problem and run this again.');
      process.exit(1);
    }
  }

  // Only now is the old key retired.
  await writeMeta(client, next);
  console.log('Done. The new master password is live.');
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
