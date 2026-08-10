/**
 * Asset tagging.
 *
 * Previously this lived alongside a hand-written Code 128 encoder, back when
 * labels carried a barcode as well as a QR. The label is QR-only now, so the
 * encoder is gone and only the tag allocation it fed remains.
 */

/**
 * Short codes per asset category, used to build a readable tag (GC-LT-0007).
 * The label is what the dropdown shows; the code must stay unique and stable,
 * since it is printed on physical labels and changing it renames every tag.
 */
const CATEGORIES: { id: string; label: string; code: string }[] = [
  { id: 'laptop', label: 'Laptop', code: 'LT' },
  { id: 'desktop', label: 'Desktop', code: 'DT' },
  { id: 'monitor', label: 'Monitor', code: 'MN' },
  { id: 'tablet', label: 'Tablet', code: 'TB' },
  { id: 'phone', label: 'Phone', code: 'PH' },
  { id: 'keyboard', label: 'Keyboard', code: 'KB' },
  { id: 'mouse', label: 'Mouse', code: 'MS' },
  { id: 'printer', label: 'Printer / scanner', code: 'PT' },
  { id: 'headphones', label: 'Headphones', code: 'HP' },
  { id: 'ups', label: 'UPS / power', code: 'UP' },
  { id: 'charger', label: 'Charger', code: 'CG' },
  { id: 'other', label: 'Other', code: 'AS' },
];

const CATEGORY_CODE: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.code]),
);

/** Ids for the picker, in the curated order above. */
export const ASSET_CATEGORIES = CATEGORIES.map((c) => c.id);

/** Categories a CPU/RAM/storage spec sheet actually applies to. */
export const SPECABLE_CATEGORIES = new Set(['laptop', 'desktop']);
export const isSpecable = (category: string | null) => SPECABLE_CATEGORIES.has(category ?? '');

/**
 * RAM and storage are entered as free text so "16 GB" and "1 TB SSD" both fit,
 * but a bare number typed without a unit ("8", "256") is unambiguously GB in
 * practice, so that unit is filled in for display rather than left silent.
 */
export const withGb = (value: string | null): string | null =>
  value && /^\d+$/.test(value.trim()) ? `${value.trim()} GB` : value;

/** Human labels, so the dropdown reads "Storage / NAS" not "storage". */
export const ASSET_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
);

/**
 * Next free tag for a category, in the form GC-LT-0007.
 *
 * Sequential rather than random so a shelf of labels reads in order, and gaps
 * left by retired kit get reused rather than counted past.
 */
export function nextAssetTag(category: string | null, existing: (string | null)[]): string {
  const code = CATEGORY_CODE[category ?? 'other'] ?? 'AS';
  const prefix = `GC-${code}-`;

  const used = new Set(
    existing
      .filter((tag): tag is string => !!tag && tag.startsWith(prefix))
      .map((tag) => Number.parseInt(tag.slice(prefix.length), 10))
      .filter((n) => Number.isFinite(n)),
  );

  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${String(n).padStart(4, '0')}`;
}
