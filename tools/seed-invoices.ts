/**
 * Bulk-load a folder of PDF invoices into the vault.
 *
 *   node --env-file=.env.local tools/seed-invoices.ts --dir "C:\path\to\invoices"
 *
 * The same job the in-app folder importer does, but from Node so a large batch
 * can be loaded once without a browser. Each PDF is read for its text layer,
 * turned into a billing entry with lib/ocr.ts and lib/billing.ts (the exact
 * code the app uses), encrypted under the master password, and inserted.
 *
 * Re-runnable: a bill already present (same vendor, amount and invoice number)
 * is skipped, so running twice does not duplicate.
 *
 * Set VAULT_MASTER_PASSWORD to skip the prompt.
 */

import { createInterface } from 'node:readline';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// pdf.js 6 touches DOMMatrix at module scope and text extraction never uses it,
// so a stub is enough to load the library outside a browser.
if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    translate() { return this; }
    scale() { return this; }
    multiply() { return this; }
  };
}

import { checkVerifier, deriveKey, makeVerifier, randomSalt, PBKDF2_ITERATIONS } from '../lib/crypto.ts';
import { fetchMeta, loadItems, insertMany, writeMeta } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import { readInvoice } from '../lib/ocr.ts';
import { applyInvoice } from '../lib/billing.ts';
import type { ItemFields, VaultMeta } from '../lib/types.ts';

/* ------------------------------------------------------------ pdf text ---- */

/** Extract the text layer of a PDF in Node, worker disabled. */
async function pdfText(path: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false } as never).promise;

  let text = '';
  for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith('\n')) text += ' ';
      text += item.str;
      if (y != null) lastY = y;
    }
    text += '\n';
  }
  return text;
}

/* -------------------------------------------------------------- prompt ---- */

function ask(question: string, silent = false): Promise<string> {
  return new Promise((done) => {
    process.stdout.write(question);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (silent) (rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {};
    rl.question('', (answer) => {
      if (silent) process.stdout.write('\n');
      rl.close();
      done(answer.trim());
    });
  });
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

  const dir = resolve(arg('dir', ''));
  if (!dir || !existsSync(dir)) {
    console.error(`Folder not found: ${dir || '(none given, use --dir)'}`);
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
  if (files.length === 0) {
    console.error('No PDFs in that folder.');
    process.exit(1);
  }
  console.log(`Reading ${files.length} PDFs from ${dir} ...\n`);

  const parsed: ItemFields[] = [];
  for (const file of files) {
    try {
      const text = await pdfText(join(dir, file));
      const guess = readInvoice(text);
      if (!guess.vendor && guess.amount == null) {
        console.log(`  skip  ${file}  (no vendor or amount found)`);
        continue;
      }
      const fields = applyInvoice(guess);
      parsed.push(fields);
      const b = fields.billing!;
      console.log(
        `  ok    ${basename(file).padEnd(34)} ${(b.vendor ?? '?').padEnd(12)} ` +
          `${b.currency} ${b.amount ?? '?'}  ${b.paidOn ?? ''}  ${b.invoiceNumber ?? ''}`,
      );
    } catch (error) {
      console.log(`  fail  ${file}  ${error instanceof Error ? error.message : error}`);
    }
  }

  if (parsed.length === 0) {
    console.error('\nNothing readable. Aborting.');
    process.exit(1);
  }

  const client = createServerClient(url, key);
  const existing = await fetchMeta(client);

  let meta: VaultMeta;
  let cryptoKey: CryptoKey;

  const password = process.env.VAULT_MASTER_PASSWORD ?? (await ask('\n  Master password: ', true));

  if (existing) {
    cryptoKey = await deriveKey(password, existing.kdfSalt, existing.kdfIterations);
    if (!(await checkVerifier(cryptoKey, { iv: existing.verifierIv, ciphertext: existing.verifierCt }))) {
      console.error('\nThat password does not match this vault. Nothing was written.');
      process.exit(1);
    }
    meta = existing;
  } else {
    meta = { kdfSalt: randomSalt(), kdfIterations: PBKDF2_ITERATIONS, verifierIv: '', verifierCt: '' };
    cryptoKey = await deriveKey(password, meta.kdfSalt, meta.kdfIterations);
    const verifier = await makeVerifier(cryptoKey);
    meta.verifierIv = verifier.iv;
    meta.verifierCt = verifier.ciphertext;
    await writeMeta(client, meta);
    console.log('  Created a new vault.');
  }

  // Skip bills already present, keyed the way a human would tell them apart.
  const { items } = await loadItems(client, cryptoKey);
  const identity = (b: ItemFields['billing']) =>
    `${b?.vendor ?? ''}|${b?.amount ?? ''}|${b?.invoiceNumber ?? ''}`;
  const seen = new Set(items.filter((i) => i.kind === 'billing').map((i) => identity(i.billing)));
  const fresh = parsed.filter((i) => !seen.has(identity(i.billing)));

  if (fresh.length === 0) {
    console.log('\nEvery invoice is already in the vault. Nothing to do.');
    return;
  }

  console.log(`\nEncrypting and inserting ${fresh.length} bills ...`);
  const written = await insertMany(client, cryptoKey, fresh);
  console.log(`Done. ${written} written, ${parsed.length - fresh.length} skipped as duplicates.`);
  console.log('\nReload the app and open Billing.');
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
