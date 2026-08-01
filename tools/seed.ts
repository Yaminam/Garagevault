/**
 * Seed the vault from the master tracker spreadsheet.
 *
 *   npm run seed
 *
 * Reads the Credentials sheet, encrypts every row with the master password, and
 * inserts the ciphertext into Supabase. The plaintext never leaves this process
 * and is never written to disk.
 *
 * If the vault already exists, the password must match the one it was created
 * with, otherwise the new rows would be unreadable alongside the old ones.
 */

import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PBKDF2_ITERATIONS,
  checkVerifier,
  deriveKey,
  makeVerifier,
  randomSalt,
} from '../lib/crypto.ts';
import { fetchMeta, insertMany, loadItems, writeMeta } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import type { ItemFields, VaultMeta } from '../lib/types.ts';
import { readWorkbook } from './xlsx.ts';
import { buildItems } from '../lib/sheet.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

async function readMasterPassword(creating: boolean): Promise<string> {
  if (process.env.VAULT_MASTER_PASSWORD) {
    console.log('Using master password from VAULT_MASTER_PASSWORD.');
    return process.env.VAULT_MASTER_PASSWORD;
  }

  if (!creating) return ask('  Master password: ', true);

  console.log('  This password derives the key for every entry. It is not stored anywhere.');
  for (;;) {
    const pw = await ask('  Choose a master password: ', true);
    if (pw.length < 12) {
      console.log('  Too short. Use at least 12 characters.\n');
      continue;
    }
    const again = await ask('  Confirm:                  ', true);
    if (pw !== again) {
      console.log('  Passwords did not match.\n');
      continue;
    }
    return pw;
  }
}

/* ---------------------------------------------------------------- main ---- */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  // Source spreadsheets live in the sibling data folder (../data), kept out of
  // the code repo entirely. Override with --in for a file elsewhere.
  const input = resolve(ROOT, arg('in', '../data/Garage_AI_Master_Tracker.xlsx'));
  if (!existsSync(input)) {
    console.error(`Spreadsheet not found: ${input}`);
    process.exit(1);
  }

  console.log(`Reading ${basename(input)} ...`);
  const parsed: ItemFields[] = buildItems(readWorkbook(input));
  if (parsed.length === 0) {
    console.error('No credential rows found. Check the sheet headers.');
    process.exit(1);
  }

  const withSecret = parsed.filter((i) => i.password).length;
  console.log(`  ${parsed.length} rows, ${withSecret} with a password\n`);

  const client = createServerClient(url, key);
  const existing = await fetchMeta(client);

  let meta: VaultMeta;
  let cryptoKey: CryptoKey;

  if (existing) {
    console.log('Vault already exists. Enter its master password to add these rows.');
    const password = await readMasterPassword(false);
    cryptoKey = await deriveKey(password, existing.kdfSalt, existing.kdfIterations);
    const ok = await checkVerifier(cryptoKey, {
      iv: existing.verifierIv,
      ciphertext: existing.verifierCt,
    });
    if (!ok) {
      console.error('\nThat password does not match this vault. Nothing was written.');
      process.exit(1);
    }
    meta = existing;
  } else {
    console.log('No vault yet. Creating one.');
    const password = await readMasterPassword(true);
    meta = {
      kdfSalt: randomSalt(),
      kdfIterations: PBKDF2_ITERATIONS,
      verifierIv: '',
      verifierCt: '',
    };
    cryptoKey = await deriveKey(password, meta.kdfSalt, meta.kdfIterations);
    const verifier = await makeVerifier(cryptoKey);
    meta.verifierIv = verifier.iv;
    meta.verifierCt = verifier.ciphertext;
    await writeMeta(client, meta);
    console.log('  Vault created.');
  }

  // Skip rows that are already there, so re-running is safe.
  const { items: current } = await loadItems(client, cryptoKey);
  const seen = new Set(current.map((i) => `${i.title}|${i.username ?? ''}|${i.password ?? ''}`));
  const fresh = parsed.filter(
    (i) => !seen.has(`${i.title}|${i.username ?? ''}|${i.password ?? ''}`),
  );

  if (fresh.length === 0) {
    console.log('\nEverything in the sheet is already in the vault. Nothing to do.');
    return;
  }

  console.log(`\nEncrypting and inserting ${fresh.length} rows ...`);
  const inserted = await insertMany(client, cryptoKey, fresh);

  console.log(`Done. ${inserted} rows written, ${parsed.length - fresh.length} skipped as duplicates.`);
  console.log('\nStart the app with npm run dev and unlock with that master password.');
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
