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

/** One line of the spec sheet: a free-text value under a category-specific label. */
export type SpecField = { key: string; label: string; placeholder?: string };

const COMPUTER_SPECS: SpecField[] = [
  { key: 'cpu', label: 'CPU', placeholder: 'Apple M2 Pro' },
  { key: 'ram', label: 'RAM', placeholder: '16 GB' },
  { key: 'storage', label: 'Storage', placeholder: '512 GB SSD' },
  { key: 'gpu', label: 'GPU', placeholder: 'Integrated' },
];

/**
 * What the Specs section asks for, per category. A monitor has no CPU and a
 * mouse has nothing here at all, so this is keyed by category rather than
 * being one fixed CPU/RAM/storage/GPU sheet applied everywhere.
 */
const SPEC_FIELDS: Record<string, SpecField[]> = {
  laptop: COMPUTER_SPECS,
  desktop: COMPUTER_SPECS,
  tablet: [
    { key: 'storage', label: 'Storage', placeholder: '128 GB' },
    { key: 'connectivity', label: 'Connectivity', placeholder: 'Wi-Fi + cellular' },
  ],
  phone: [
    { key: 'storage', label: 'Storage', placeholder: '128 GB' },
    { key: 'imei', label: 'IMEI' },
  ],
  monitor: [
    { key: 'size', label: 'Screen size', placeholder: '27"' },
    { key: 'resolution', label: 'Resolution', placeholder: '2560 x 1440' },
  ],
  printer: [{ key: 'consumable', label: 'Ink / toner', placeholder: 'HP 678 cartridge' }],
  headphones: [{ key: 'connectivity', label: 'Connectivity', placeholder: 'Bluetooth' }],
  ups: [
    { key: 'capacity', label: 'Capacity', placeholder: '1500 VA' },
    { key: 'backup', label: 'Backup time', placeholder: '20 min at half load' },
  ],
  charger: [
    { key: 'wattage', label: 'Wattage', placeholder: '65 W' },
    { key: 'connector', label: 'Connector', placeholder: 'USB-C' },
  ],
};

export const specFieldsFor = (category: string | null): SpecField[] =>
  SPEC_FIELDS[category ?? ''] ?? [];

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
 * Category -> chart colour, fixed by category id in the same order as the
 * picker above rather than by count or rank, so re-sorting a chart never
 * repaints which colour a category means. Only eight hues are validated as
 * colourblind-distinguishable as a set; a category past that eighth slot
 * folds to a neutral grey rather than cycling back to a colour already in
 * use on screen.
 */
const CATEGORY_COLOR_VAR: Record<string, string> = Object.fromEntries(
  CATEGORIES.slice(0, 8).map((c, i) => [c.id, `var(--chart-cat-${i + 1})`]),
);
export const categoryColor = (category: string): string =>
  CATEGORY_COLOR_VAR[category] ?? 'var(--ink-3)';

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
