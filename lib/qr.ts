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
 * `M` corrects roughly 15% damage, which is the usual choice for a label that
 * will pick up scuffs but is not going somewhere abrasive.
 */
export function encodeQr(text: string, level: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix {
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

const line = (key: string, value: string | null | undefined) =>
  value ? `${key}=${String(value).replace(/[\r\n]+/g, ' ').trim()}\n` : '';

/**
 * What the QR on an asset label actually contains.
 *
 * Plain `key=value` lines rather than JSON, so any phone camera shows something
 * a human can read without an app. Deliberately excludes anything secret: a
 * label is on the outside of a device that walks out of the building.
 */
export function assetQrPayload(item: VaultItem): string {
  const asset = item.asset;
  if (!asset) return '';

  return (
    'GARAGE-ASSET\n' +
    line('tag', asset.tag) +
    line('name', item.title) +
    line('category', asset.category) +
    line('make', asset.make) +
    line('model', asset.model) +
    line('serial', asset.serial) +
    line('status', asset.status) +
    line('entity', item.entity) +
    line('holder', item.owner?.name) +
    line('department', item.owner?.department) +
    line('location', asset.location) +
    line('purchased', asset.purchasedOn) +
    line('warranty', asset.warrantyUntil) +
    line('received', asset.received ? (asset.receivedOn ?? 'yes') : 'no')
  ).trimEnd();
}

/** Parse a payload back, for the scanner. Unknown keys are kept. */
export function parseAssetQr(text: string): Record<string, string> | null {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows[0] !== 'GARAGE-ASSET') return null;

  const out: Record<string, string> = {};
  for (const row of rows.slice(1)) {
    const at = row.indexOf('=');
    if (at > 0) out[row.slice(0, at)] = row.slice(at + 1);
  }
  return out;
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
