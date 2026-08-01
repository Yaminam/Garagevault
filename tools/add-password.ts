/**
 * Grant a password access to the vault.
 *
 *   npm run add:password -- --password "someone@example.com" \
 *       --name "Their Name" --email "someone@example.com" --label "Their laptop"
 *
 * Nothing is re-encrypted. The vault key stays exactly what it was; this seals
 * a copy of it under the new password and stores that one small record. The
 * same is true in reverse: revoking a password deletes its record and leaves
 * every row untouched.
 *
 * With `--name` and `--email`, opening the vault with this password also says
 * who is using the browser, and the identity prompt is skipped. Without them
 * it is an anonymous password and the prompt still appears.
 *
 * Needs the master password, which is the only thing that can produce the
 * vault key to be copied. Prompted with hidden input, so run it in a real
 * terminal.
 */

import { createInterface } from 'node:readline';
import { checkVerifier, deriveKeyBits, importAesKey } from '../lib/crypto.ts';
import { addAccount, listAccounts } from '../lib/users.ts';
import { fetchMeta } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';

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

  const newPassword = arg('password');
  if (!newPassword) {
    console.error('Pass the password to grant:  npm run add:password -- --password "..."');
    process.exit(1);
  }

  const name = arg('name');
  const email = arg('email');
  const label = arg('label') ?? (name ? `${name}'s password` : 'Shared password');
  const identity = name && email ? { name, email } : null;

  const client = createServerClient(url, key);
  const meta = await fetchMeta(client);
  if (!meta) {
    console.error('No vault exists yet. Create one in the app first.');
    process.exit(1);
  }

  const master = process.env.VAULT_MASTER_PASSWORD ?? (await ask('  Master password: ', true));

  // The vault key, as raw bytes, so it can be sealed under the new password.
  const vaultBits = await deriveKeyBits(master, meta.kdfSalt, meta.kdfIterations);
  const vaultKey = await importAesKey(vaultBits);
  if (!(await checkVerifier(vaultKey, { iv: meta.verifierIv, ciphertext: meta.verifierCt }))) {
    console.error('\nThat master password does not match this vault. Nothing was written.');
    process.exit(1);
  }

  // The new password's own key. Same salt and iterations as the vault, which
  // is what lets an unlock try both routes from a single derivation.
  const accountKey = await importAesKey(
    await deriveKeyBits(newPassword, meta.kdfSalt, meta.kdfIterations),
  );

  // A password that already opens the vault would otherwise be added twice and
  // the duplicate would sit there doing nothing.
  const existing = await listAccounts(client);
  for (const row of existing) {
    try {
      const { unwrapSecret } = await import('../lib/crypto.ts');
      await unwrapSecret(accountKey, { iv: row.key_iv, ciphertext: row.key_ct });
      console.error(`\nThat password already opens the vault (${row.label ?? 'unlabelled'}).`);
      process.exit(1);
    } catch {
      // Good: this record is a different password.
    }
  }

  await addAccount(client, vaultBits, accountKey, { identity, label });

  console.log(`\nDone. "${label}" can now open the vault.`);
  if (identity) {
    console.log(`Opening with it signs in as ${identity.name} <${identity.email}>.`);
  } else {
    console.log('It carries no identity, so the "who is using this" prompt still appears.');
  }
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
