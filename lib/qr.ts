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
    line('email', item.owner?.email) +
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

export const STATUS_FROM_QR = (value: string | undefined): AssetStatus =>
  value === 'spare' || value === 'repair' || value === 'retired' ? value : 'in-use';
