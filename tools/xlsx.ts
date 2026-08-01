/**
 * Node side of the .xlsx reader. Unzips with zlib, then hands the parts to the
 * shared parser in lib/xlsx-core.ts.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import {
  isNeededPart,
  parseWorkbook,
  readZipIndex,
  type Parts,
  type Sheet,
} from '../lib/xlsx-core.ts';

export type { Cell, Sheet } from '../lib/xlsx-core.ts';

export function readWorkbook(path: string): Sheet[] {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const entries = readZipIndex(view);

  const parts: Parts = new Map();
  for (const entry of entries) {
    if (!isNeededPart(entry.name)) continue;
    const slice = buffer.subarray(entry.start, entry.start + entry.size);
    const bytes = entry.stored ? slice : inflateRawSync(slice);
    parts.set(entry.name, bytes.toString('utf8'));
  }

  return parseWorkbook(parts);
}
