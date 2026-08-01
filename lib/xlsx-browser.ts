/**
 * Browser side of the .xlsx reader.
 *
 * Uses DecompressionStream for the deflate, so there is no bundled zip library
 * and the spreadsheet never leaves the tab: it is read, parsed, encrypted and
 * posted as ciphertext without ever being uploaded anywhere.
 */

import { isNeededPart, parseWorkbook, readZipIndex, type Parts, type Sheet } from './xlsx-core.ts';

/**
 * Exported because `.docx` is a zip too, so the document reader inflates its
 * parts with exactly this. Still no bundled zip library either way.
 */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .xlsx files. Try Chrome, Edge or Safari 16.4+.');
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readWorkbookFromFile(file: File): Promise<Sheet[]> {
  const buffer = await file.arrayBuffer();
  const entries = readZipIndex(new DataView(buffer));

  const decoder = new TextDecoder();
  const parts: Parts = new Map();

  for (const entry of entries) {
    if (!isNeededPart(entry.name)) continue;
    const slice = new Uint8Array(buffer, entry.start, entry.size);
    const bytes = entry.stored ? slice : await inflateRaw(slice);
    parts.set(entry.name, decoder.decode(bytes));
  }

  if (!parts.has('xl/workbook.xml')) {
    throw new Error('That does not look like an .xlsx workbook.');
  }

  return parseWorkbook(parts);
}
