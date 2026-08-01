/**
 * Revoke a password's access to the vault.
 *
 *   npm run remove:password -- --password "someone@example.com"
 *
 * Deletes that password's record and nothing else. The vault key is untouched,
 * so every row stays exactly as it was and no other password is affected.
 *
 * The record is found by trying the password against each one, the same way an
 * unlock does, because the table stores no email or handle to look anyone up
 * by. That also means this cannot revoke a password nobody can produce: if it
 * does not open the vault, there is nothing here to delete.
 *
 * The original master password cannot be revoked this way. It derives the
 * vault key directly rather than holding a copy of it, so removing it means
 * `npm run rekey`, which re-encrypts everything under a new one.
 */

import { createInterface } from 'node:readline';
import { checkVerifier, deriveKeyBits, importAesKey, open, unwrapSecret } from '../lib/crypto.ts';
import { listAccounts, removeAccount } from '../lib/users.ts';
import { fetchMeta } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import type { Identity } from '../lib/identity.ts';

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

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  const target = arg('password') ?? (await ask('  Password to revoke: ', true));
  if (!target) {
    console.error('Nothing to revoke.');
    process.exit(1);
  }

  const client = createServerClient(url, key);
  const meta = await fetchMeta(client);
  if (!meta) {
    console.error('No vault exists yet.');
    process.exit(1);
  }

  const candidate = await importAesKey(
    await deriveKeyBits(target, meta.kdfSalt, meta.kdfIterations),
  );

  if (await checkVerifier(candidate, { iv: meta.verifierIv, ciphertext: meta.verifierCt })) {
    console.error(
      '\nThat is the master password. It derives the vault key rather than holding a copy,\n' +
        'so it cannot be revoked here. Use npm run rekey to change it.',
    );
    process.exit(1);
  }

  const rows = await listAccounts(client);
  for (const row of rows) {
    try {
      await unwrapSecret(candidate, { iv: row.key_iv, ciphertext: row.key_ct });
    } catch {
      continue; // Not this one.
    }

    let who = row.label ?? 'unlabelled';
    if (row.profile_iv && row.profile_ct) {
      try {
        const identity = await open<Identity>(candidate, {
          iv: row.profile_iv,
          ciphertext: row.profile_ct,
        });
        who = `${identity.name} <${identity.email}>`;
      } catch {
        // Keep the label.
      }
    }

    await removeAccount(client, row.id);
    console.log(`\nRevoked: ${who}`);
    console.log('That password no longer opens the vault. No rows were re-encrypted.');
    return;
  }

  console.error('\nThat password does not open this vault, so there is nothing to revoke.');
  process.exit(1);
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
