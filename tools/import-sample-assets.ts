/**
 * Import the sample asset list carried over from the IT-asset-tracker
 * reference project (its `supabase/schema.sql` seed rows), translated into
 * Garage Vault's asset shape. Laptops get a CPU/RAM/storage/GPU spec sheet;
 * the monitor and UPS do not, since neither has one.
 *
 *   npm run import:sample-assets
 *
 * Skips any row whose serial number is already in the vault, so re-running is
 * safe. Needs the master password, prompted with hidden input.
 */

import { createInterface } from 'node:readline';
import { checkVerifier, deriveKey } from '../lib/crypto.ts';
import { fetchMeta, insertMany, loadItems } from '../lib/repository.ts';
import { createServerClient } from '../lib/supabase.ts';
import { emptyAsset } from '../lib/types.ts';
import type { ItemFields } from '../lib/types.ts';
import { nextAssetTag } from '../lib/assets.ts';

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

/** The six rows from the reference project's seed data. */
const SOURCE: {
  category: string;
  brand: string;
  model: string;
  serial: string;
  purchasedOn: string;
  warrantyStart: string;
  warrantyUntil: string;
  specs?: { cpu: string; ram: string; storage: string; gpu: string };
}[] = [
  {
    category: 'laptop',
    brand: 'Dell',
    model: 'XPS 15',
    serial: 'DELL-XPS-001',
    purchasedOn: '2023-01-10',
    warrantyStart: '2023-01-10',
    warrantyUntil: '2026-01-10',
    specs: { cpu: 'Intel Core i7-12700H', ram: '16 GB', storage: '512 GB SSD', gpu: 'NVIDIA RTX 3050' },
  },
  {
    category: 'laptop',
    brand: 'Apple',
    model: 'MacBook Pro 16',
    serial: 'APPLE-MBP-001',
    purchasedOn: '2023-02-15',
    warrantyStart: '2023-02-15',
    warrantyUntil: '2026-02-15',
    specs: { cpu: 'Apple M2 Pro', ram: '16 GB unified', storage: '512 GB SSD', gpu: '19-core GPU (integrated)' },
  },
  {
    category: 'desktop',
    brand: 'HP',
    model: 'EliteDesk 800',
    serial: 'HP-ED-001',
    purchasedOn: '2023-03-01',
    warrantyStart: '2023-03-01',
    warrantyUntil: '2026-03-01',
    specs: { cpu: 'Intel Core i5-12500', ram: '8 GB', storage: '256 GB SSD', gpu: 'Integrated' },
  },
  {
    category: 'headphones',
    brand: 'Sony',
    model: 'WH-1000XM5',
    serial: 'SONY-WH-001',
    purchasedOn: '2023-04-10',
    warrantyStart: '2023-04-10',
    warrantyUntil: '2024-04-10',
  },
  {
    category: 'ups',
    brand: 'APC',
    model: 'Back-UPS Pro 1500',
    serial: 'APC-UPS-001',
    purchasedOn: '2023-05-20',
    warrantyStart: '2023-05-20',
    warrantyUntil: '2026-05-20',
  },
  {
    category: 'monitor',
    brand: 'LG',
    model: '27UK850',
    serial: 'LG-MON-001',
    purchasedOn: '2023-06-15',
    warrantyStart: '2023-06-15',
    warrantyUntil: '2026-06-15',
  },
];

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
    console.error('No vault exists yet. Create one in the app first.');
    process.exit(1);
  }

  const password = process.env.VAULT_MASTER_PASSWORD ?? (await ask('  Master password: ', true));
  const cryptoKey = await deriveKey(password, meta.kdfSalt, meta.kdfIterations);
  if (!(await checkVerifier(cryptoKey, { iv: meta.verifierIv, ciphertext: meta.verifierCt }))) {
    console.error('\nThat master password does not match this vault. Nothing was written.');
    process.exit(1);
  }

  const { items: current } = await loadItems(client, cryptoKey);
  const existingSerials = new Set(
    current.map((i) => i.asset?.serial).filter((s): s is string => !!s),
  );
  const existingTags = current.map((i) => i.asset?.tag ?? null);

  const fresh = SOURCE.filter((row) => !existingSerials.has(row.serial));
  if (fresh.length === 0) {
    console.log('\nAll sample assets are already in the vault. Nothing to do.');
    return;
  }

  const tags = [...existingTags];
  const batch: ItemFields[] = fresh.map((row) => {
    const tag = nextAssetTag(row.category, tags);
    tags.push(tag);

    const base = emptyAsset(tag);
    return {
      ...base,
      title: `${row.brand} ${row.model}`,
      asset: {
        ...base.asset!,
        tag,
        category: row.category,
        make: row.brand,
        model: row.model,
        serial: row.serial,
        status: 'spare',
        purchasedOn: row.purchasedOn,
        warrantyStart: row.warrantyStart,
        warrantyUntil: row.warrantyUntil,
        specs: row.specs ?? null,
      },
    };
  });

  console.log(`\nEncrypting and inserting ${batch.length} asset(s) ...`);
  const inserted = await insertMany(client, cryptoKey, batch);
  console.log(
    `Done. ${inserted} row(s) written, ${SOURCE.length - fresh.length} skipped as already present.`,
  );
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
