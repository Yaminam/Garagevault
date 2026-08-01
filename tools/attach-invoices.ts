/**
 * Attach a folder of invoice PDFs to the bills already in the vault.
 *
 *   npm run attach:invoices -- --in "C:\path\to\vendor-invoices"
 *   npm run attach:invoices -- --in ./vendor-invoices --apply
 *
 * Dry by default. It prints the pairing it worked out and changes nothing
 * until `--apply`, because the matching is inference: a filename is not a
 * foreign key, and a confidently wrong pairing files a bill under the wrong
 * vendor where nobody will ever notice.
 *
 * Matching, in order, first hit wins:
 *
 *   1. Invoice number in the filename against the bill's invoice number.
 *   2. Vendor plus exact date.
 *   3. Vendor plus month, when only one bill from that vendor is in that month.
 *   4. Vendor plus month plus amount, when the filename carries a trailing
 *      number and several bills share the month. `anthropic_june_03_2026_320`
 *      is three bills on one day, told apart only by what they cost.
 *
 * Anything still ambiguous is reported and skipped. Bills that already carry a
 * file are left alone, so a second run is safe.
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { checkVerifier, deriveKey } from '../lib/crypto.ts';
import { uploadAttachment } from '../lib/attachments.ts';
import { fetchMeta, loadItems, updateItem } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import type { ItemFields, VaultItem } from '../lib/types.ts';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/* -------------------------------------------------------------- prompt ---- */

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

/* --------------------------------------------------------------- parse ---- */

type Parsed = {
  file: string;
  vendor: string;
  month: number | null;
  day: number | null;
  year: number | null;
  /** Trailing number, which in this folder means an amount. */
  hint: number | null;
  /** Invoice-number-looking token, e.g. NFBZ0UCA-0004. */
  code: string | null;
};

function parseName(file: string): Parsed {
  const stem = basename(file, extname(file)).toLowerCase();
  const parts = stem.split(/[_\s-]+/).filter(Boolean);

  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  let hint: number | null = null;

  for (const part of parts) {
    const asMonth = MONTHS.indexOf(part);
    if (asMonth > -1 && month === null) {
      month = asMonth + 1;
      continue;
    }
    if (/^\d{4}$/.test(part) && Number(part) > 2000) {
      year = Number(part);
      continue;
    }
    if (/^\d{1,2}$/.test(part) && day === null && month !== null) {
      day = Number(part);
      continue;
    }
    if (/^\d+$/.test(part)) hint = Number(part);
  }

  // An invoice code is an alphanumeric run with a digit in it, not a date part.
  const raw = basename(file, extname(file));
  const code =
    raw.match(/\b[A-Z0-9]{6,}[-_][0-9]{2,}\b/i)?.[0] ??
    raw.match(/\b[A-Z]{3,}[0-9][A-Z0-9]{3,}\b/i)?.[0] ??
    null;

  return { file, vendor: parts[0] ?? '', month, day, year, hint, code };
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function billDate(bill: VaultItem): string | null {
  return bill.billing?.paidOn ?? bill.billing?.nextRenewal ?? null;
}

/** Does this bill's vendor, entity or title mention the filename's vendor? */
function vendorMatches(bill: VaultItem, vendor: string): boolean {
  if (!vendor) return false;
  const hay = norm([bill.billing?.vendor, bill.entity, bill.title].filter(Boolean).join(' '));
  return hay.includes(norm(vendor));
}

type Match = { bill: VaultItem; why: string } | { bill: null; why: string };

function match(parsed: Parsed, bills: VaultItem[]): Match {
  // 1. Invoice number.
  if (parsed.code) {
    const wanted = norm(parsed.code);
    const hit = bills.find(
      (bill) => bill.billing?.invoiceNumber && norm(bill.billing.invoiceNumber) === wanted,
    );
    if (hit) return { bill: hit, why: `invoice number ${parsed.code}` };
  }

  const sameVendor = bills.filter((bill) => vendorMatches(bill, parsed.vendor));
  if (sameVendor.length === 0) {
    return { bill: null, why: `no bill from "${parsed.vendor}"` };
  }

  // 2. Vendor plus exact date.
  if (parsed.year && parsed.month && parsed.day) {
    const iso = `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
    const exact = sameVendor.filter((bill) => billDate(bill) === iso);
    if (exact.length === 1) return { bill: exact[0], why: `vendor and date ${iso}` };

    // 4. Several on one day: the trailing number is the amount.
    if (exact.length > 1 && parsed.hint != null) {
      const byAmount = exact.filter(
        (bill) => Math.round(Math.abs(bill.billing?.amount ?? -1)) === parsed.hint,
      );
      if (byAmount.length === 1) {
        return { bill: byAmount[0], why: `vendor, date ${iso} and amount ${parsed.hint}` };
      }
    }
    if (exact.length > 1) {
      return { bill: null, why: `${exact.length} bills from ${parsed.vendor} on ${iso}` };
    }
  }

  // 3. Vendor plus month.
  if (parsed.year && parsed.month) {
    const ym = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
    const inMonth = sameVendor.filter((bill) => billDate(bill)?.startsWith(ym));
    if (inMonth.length === 1) return { bill: inMonth[0], why: `vendor and month ${ym}` };

    if (inMonth.length > 1 && parsed.hint != null) {
      const byAmount = inMonth.filter(
        (bill) => Math.round(Math.abs(bill.billing?.amount ?? -1)) === parsed.hint,
      );
      if (byAmount.length === 1) {
        return { bill: byAmount[0], why: `vendor, month ${ym} and amount ${parsed.hint}` };
      }
    }
    if (inMonth.length > 1) {
      return { bill: null, why: `${inMonth.length} bills from ${parsed.vendor} in ${ym}` };
    }
    return { bill: null, why: `no ${parsed.vendor} bill dated ${ym}` };
  }

  if (sameVendor.length === 1) return { bill: sameVendor[0], why: 'only bill from this vendor' };
  return { bill: null, why: `${sameVendor.length} bills from ${parsed.vendor}, no date in the name` };
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
    console.error('Pass the folder:  npm run attach:invoices -- --in "path/to/folder"');
    process.exit(1);
  }
  const dir = resolve(input);
  if (!existsSync(dir)) {
    console.error(`Folder not found: ${dir}`);
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const files = readdirSync(dir)
    .filter((name) => /\.(pdf|png|jpe?g|webp)$/i.test(name))
    .sort();

  if (files.length === 0) {
    console.error('No PDFs or images in that folder.');
    process.exit(1);
  }
  console.log(`${files.length} files in ${dir}\n`);

  const client = createServerClient(url, key);
  const meta = await fetchMeta(client);
  if (!meta) {
    console.error('No vault exists yet.');
    process.exit(1);
  }

  const password = process.env.VAULT_MASTER_PASSWORD ?? (await ask('  Master password: ', true));
  const cryptoKey = await deriveKey(password, meta.kdfSalt, meta.kdfIterations);
  if (!(await checkVerifier(cryptoKey, { iv: meta.verifierIv, ciphertext: meta.verifierCt }))) {
    console.error('\nThat password does not match this vault. Nothing was written.');
    process.exit(1);
  }

  const { items } = await loadItems(client, cryptoKey);
  const bills = items.filter((item) => item.kind === 'billing' && item.billing);
  console.log(`${bills.length} bills in the vault\n`);

  // One bill takes one file: two names claiming the same bill is a sign the
  // match rules are too loose, and silently letting the second win would hide
  // that. Claimed ids are tracked so the clash is reported instead.
  const claimed = new Map<string, string>();
  const plan: { parsed: Parsed; bill: VaultItem; why: string }[] = [];
  const skipped: { file: string; why: string }[] = [];

  /*
   * Most specific filename first, and each match takes its bill out of the
   * running for the rest. Order is what resolves the common case:
   * `anthropic_may_2026` is ambiguous between two May bills on its own, but
   * once `anthropic_may_27_2026` has claimed the dated one, only a single
   * candidate is left and the vaguer name is no longer a guess. Running it the
   * other way round would let the vague name take the dated bill and strand
   * the precise one.
   */
  const ordered = files
    .map(parseName)
    .map((parsed, index) => ({ parsed, index }))
    .sort((a, b) => {
      const rank = (p: Parsed) => (p.code ? 0 : p.day != null ? 1 : 2);
      return rank(a.parsed) - rank(b.parsed) || a.index - b.index;
    })
    .map((entry) => entry.parsed);

  for (const parsed of ordered) {
    const file = parsed.file;
    const available = bills.filter((bill) => !claimed.has(bill.id));
    const result = match(parsed, available);

    if (!result.bill) {
      skipped.push({ file, why: result.why });
      continue;
    }
    if (result.bill.billing?.file) {
      skipped.push({ file, why: 'that bill already has a file attached' });
      continue;
    }
    claimed.set(result.bill.id, file);
    plan.push({ parsed, bill: result.bill, why: result.why });
  }

  // Report in folder order, not in the order the matcher happened to work.
  plan.sort((a, b) => a.parsed.file.localeCompare(b.parsed.file));
  skipped.sort((a, b) => a.file.localeCompare(b.file));

  const pad = Math.min(38, Math.max(...files.map((f) => f.length)));
  console.log('MATCHED');
  for (const row of plan) {
    const date = billDate(row.bill) ?? 'no date';
    const amount = row.bill.billing?.amount;
    const money = amount != null ? `${row.bill.billing!.currency} ${amount}` : 'no amount';
    console.log(
      `  ${row.parsed.file.padEnd(pad)}  ->  ${row.bill.title} (${date}, ${money})   [${row.why}]`,
    );
  }

  if (skipped.length > 0) {
    console.log('\nSKIPPED');
    for (const row of skipped) console.log(`  ${row.file.padEnd(pad)}  ${row.why}`);
  }

  console.log(`\n${plan.length} matched, ${skipped.length} skipped.`);

  if (!apply) {
    console.log('\nDry run. Nothing uploaded. Re-run with --apply to attach these.');
    return;
  }

  console.log('\nEncrypting and uploading ...');
  let done = 0;
  for (const row of plan) {
    const bytes = readFileSync(join(dir, row.parsed.file));
    const source = {
      name: row.parsed.file,
      type: /\.pdf$/i.test(row.parsed.file) ? 'application/pdf' : 'image/*',
      size: bytes.byteLength,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };

    try {
      const attachment = await uploadAttachment(client, cryptoKey, source);
      const fields: ItemFields = { ...row.bill, billing: { ...row.bill.billing!, file: attachment } };
      await updateItem(client, cryptoKey, row.bill.id, fields);
      done += 1;
      process.stdout.write(`  ${done}/${plan.length}\r`);
    } catch (error) {
      console.error(
        `\n  ${row.parsed.file}: ${error instanceof Error ? error.message : 'failed'}`,
      );
    }
  }

  console.log(`\nDone. ${done} invoices attached, encrypted.`);
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
