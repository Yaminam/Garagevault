/**
 * Import a `.env` file into the vault as an Environment entry.
 *
 *   npm run import:env -- --in "C:\path\to\some.env"
 *   npm run import:env -- --in ./x.env --title "Agency site" --project "Agency"
 *
 * Reads the file, splits it into key/value pairs, encrypts the whole entry with
 * the master password and inserts the ciphertext. The plaintext never leaves
 * this process and is never written anywhere.
 *
 * Like `seed` and `rekey`, the password prompt hides input and so needs a real
 * terminal. It will not work through an editor's command runner, which has no
 * TTY and hands the prompt an immediate end-of-input.
 *
 * The vault must already exist. Creating one from a stray `.env` would be the
 * wrong way round: the master password deserves a deliberate moment, not a
 * side effect of an import.
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { checkVerifier, deriveKey } from '../lib/crypto.ts';
import { parseEnvBlock } from '../lib/env-templates.ts';
import { fetchMeta, insertItem, loadItems } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import { emptyEnv } from '../lib/types.ts';

/* -------------------------------------------------------------- prompt ---- */

function ask(question: string, silent = false): Promise<string> {
  return new Promise((done) => {
    // Write the prompt ourselves so the echo suppression below can be total.
    // Filtering inside _writeToOutput is fragile: on Windows the prompt and the
    // keystrokes do not always arrive as distinguishable chunks.
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

/** `garagecollective-agency.env (1).download` -> `garagecollective-agency`. */
function titleFromFile(path: string): string {
  return basename(path)
    .replace(/\s*\(\d+\)/, '')
    .replace(/\.download$/i, '')
    .replace(/\.env(\.[a-z]+)?$/i, '')
    .replace(/^\./, '')
    .trim() || 'Imported environment';
}

/* ---------------------------------------------------------------- main ---- */

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  const input = arg('in');
  if (!input) {
    console.error('Pass the file to import:  npm run import:env -- --in "path/to/file.env"');
    process.exit(1);
  }

  const path = resolve(input);
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }

  const vars = parseEnvBlock(readFileSync(path, 'utf8'));
  if (vars.length === 0) {
    console.error('No KEY=value lines found in that file. Nothing to import.');
    process.exit(1);
  }

  const title = arg('title') ?? titleFromFile(path);
  const project = arg('project');
  const masked = vars.filter((v) => v.secret).length;

  // Names only. Printing the values would put every secret in the terminal
  // scrollback, which is exactly what this vault exists to avoid.
  console.log(`Reading ${basename(path)} ...`);
  console.log(`  ${vars.length} variables, ${masked} treated as secret`);
  console.log(`  ${vars.map((v) => v.key).join(', ')}\n`);

  const client = createServerClient(url, key);
  const meta = await fetchMeta(client);
  if (!meta) {
    console.error('No vault exists yet. Create one in the app first, then run this.');
    process.exit(1);
  }

  console.log(`Importing as "${title}"${project ? ` under project ${project}` : ''}.`);
  const password = process.env.VAULT_MASTER_PASSWORD ?? (await ask('  Master password: ', true));

  const cryptoKey = await deriveKey(password, meta.kdfSalt, meta.kdfIterations);
  const ok = await checkVerifier(cryptoKey, {
    iv: meta.verifierIv,
    ciphertext: meta.verifierCt,
  });
  if (!ok) {
    console.error('\nThat password does not match this vault. Nothing was written.');
    process.exit(1);
  }

  // Re-running the same file should not quietly produce a second copy.
  const { items } = await loadItems(client, cryptoKey);
  const clash = items.find((item) => item.kind === 'env' && item.title === title);
  if (clash) {
    console.error(
      `\nAn environment entry called "${title}" already exists. ` +
        'Pass a different --title, or edit the existing one in the app.',
    );
    process.exit(1);
  }

  const fields = {
    ...emptyEnv(),
    title,
    vars,
    project: project ?? null,
    notes: `Imported from ${basename(path)}.`,
  };

  await insertItem(client, cryptoKey, fields);
  console.log(`\nDone. "${title}" is in the vault with ${vars.length} variables.`);
  console.log('Open the app, unlock, and it is under Environments.');
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
