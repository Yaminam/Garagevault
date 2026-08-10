/**
 * QR codes for asset labels.
 *
 * Unlike Code 128, this one is not hand rolled. QR needs Reed-Solomon error
 * correction, eight mask patterns scored against four penalty rules, and forty
 * version layouts; a subtly wrong implementation produces codes that scan on
 * one phone and fail on another. `qrcode-generator` is dependency free and has
 * been the reference JS implementation for years, so it is the safer call.
 */

import qrcode from 'qrcode-generator';
import type { AssetStatus, VaultItem } from './types.ts';

/** A square matrix of true (dark) and false (light) modules. */
export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean };

/**
 * `L` corrects roughly 7% damage. A label carrying a full URL needs more
 * modules than the short plain-text payload this used to be, and on a small
 * printed label a coarser, larger-moduled code that a phone camera can
 * actually lock onto beats one dense enough to survive a scuff it will
 * rarely take.
 */
export function encodeQr(text: string, level: 'L' | 'M' | 'Q' | 'H' = 'L'): QrMatrix {
  // Type 0 lets the library pick the smallest version that fits.
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();

  return {
    size: qr.getModuleCount(),
    dark: (row, col) => qr.isDark(row, col),
  };
}

/* --------------------------------------------------------------- payload ---- */

/**
 * What the QR on an asset label actually contains, positionally rather than
 * as `key=value` lines. The verbose form read fine on a camera's own text
 * preview, but every key name it carried made the encoded URL longer, which
 * on a small printed label means finer, harder-to-lock-onto modules. This
 * format exists only to round-trip through `parseAssetQr` below, so there is
 * no reason to spend bytes on labels a human never sees directly.
 *
 * Email and entity are dropped: entity is the same for every asset in this
 * vault, and email doesn't apply to a piece of hardware in the first place.
 */
const FIELDS = [
  'tag',
  'name',
  'category',
  'make',
  'model',
  'serial',
  'status',
  'holder',
  'department',
  'location',
  'purchased',
  'warranty',
  'received',
] as const;

const clean = (value: string | null | undefined) =>
  value ? String(value).replace(/[\r\n\x1f]+/g, ' ').trim() : '';

export function assetQrPayload(item: VaultItem): string {
  const asset = item.asset;
  if (!asset) return '';

  const values: Record<(typeof FIELDS)[number], string> = {
    tag: clean(asset.tag),
    name: clean(item.title),
    category: clean(asset.category),
    make: clean(asset.make),
    model: clean(asset.model),
    serial: clean(asset.serial),
    status: clean(asset.status),
    holder: clean(item.owner?.name),
    department: clean(item.owner?.department),
    location: clean(asset.location),
    purchased: clean(asset.purchasedOn),
    warranty: clean(asset.warrantyUntil),
    received: clean(asset.received ? (asset.receivedOn ?? 'yes') : 'no'),
  };

  return FIELDS.map((key) => values[key]).join('\x1f');
}

/** Parse a payload back, for the page the QR opens. */
export function parseAssetQr(text: string): Record<string, string> | null {
  if (!text) return null;
  const parts = text.split('\x1f');
  if (parts.length < FIELDS.length) return null;

  const out: Record<string, string> = {};
  FIELDS.forEach((key, i) => {
    if (parts[i]) out[key] = parts[i];
  });
  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------ url ---- */

// UTF-8 safe base64url, so a name with an accent round-trips. Browser only:
// both call sites (the label sheet and the page reading the fragment) run in
// the tab, never on the server.
function toBase64Url(text: string): string {
  const b64 = btoa(unescape(encodeURIComponent(text)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const b64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * What actually goes on the label now: a URL, not raw text. The old plain
 * `key=value` payload read fine in a camera's own preview but went nowhere on
 * tap, which is what a QR code is for. The same non-secret fields ride in the
 * URL fragment instead of a query string, so the data never reaches a server
 * even though nothing here is confidential in the first place.
 */
export function assetQrUrl(item: VaultItem, origin: string): string {
  return `${origin}/a#${toBase64Url(assetQrPayload(item))}`;
}

/** Empty during the server render pass; real once hydrated in the tab. */
export const currentOrigin = (): string =>
  typeof window === 'undefined' ? '' : window.location.origin;

/** The inverse, for the page the QR opens. */
export function decodeAssetQrFragment(fragment: string): Record<string, string> | null {
  try {
    return parseAssetQr(fromBase64Url(fragment));
  } catch {
    return null;
  }
}

export const STATUS_FROM_QR = (value: string | undefined): AssetStatus =>
  value === 'spare' || value === 'repair' || value === 'retired' ? value : 'in-use';
