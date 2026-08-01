/**
 * Get plain text out of whatever the user dropped.
 *
 * Four routes, picked by what the file actually is rather than by trusting the
 * extension alone:
 *
 *   .env .txt .md .ini ...   read as text
 *   .docx                    unzip, pull `word/document.xml`, strip the markup
 *   .pdf                     embedded text layer, OCR only if there isn't one
 *   .png .jpg ...            OCR
 *
 * Everything happens in the tab. Nothing is uploaded, which is the same
 * property the spreadsheet importer has and for the same reason: a file full
 * of API keys should not take a trip through a server to get into a vault
 * whose whole design is that the server never sees plaintext.
 */

import { scanDocument, type ScanProgress } from './ocr.ts';
import { readZipIndex } from './xlsx-core.ts';
import { inflateRaw } from './xlsx-browser.ts';

export type TextSource = 'plain' | 'docx' | 'pdf-text' | 'pdf-scan' | 'image';

export type Extracted = {
  text: string;
  source: TextSource;
  /** 0 to 100. Exact for anything read rather than recognised. */
  confidence: number;
};

/** Extensions we read as plain text. */
const PLAIN = /\.(env|txt|md|markdown|ini|cfg|conf|config|properties|yaml|yml|json|sh|ps1)$/i;
const DOCX = /\.docx$/i;
/** Chrome hands downloaded files a `.download` suffix; look past it. */
const DOWNLOAD_SUFFIX = /\.(download|crdownload|part)$/i;

function baseName(file: File): string {
  return file.name.replace(DOWNLOAD_SUFFIX, '');
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/**
 * Word markup to text.
 *
 * Only the structural tags matter: a paragraph is a line, a break is a line, a
 * tab is a tab. Everything else is formatting noise and comes out. Done with
 * string work rather than DOMParser so this stays usable off the main thread
 * later without dragging the DOM along.
 */
function docxToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

async function readDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const entries = readZipIndex(new DataView(buffer));
  const entry = entries.find((candidate) => candidate.name === 'word/document.xml');

  if (!entry) {
    throw new Error('That .docx has no document body. It may be corrupt, or a .doc renamed.');
  }

  const slice = new Uint8Array(buffer, entry.start, entry.size);
  const bytes = entry.stored ? slice : await inflateRaw(slice);
  return docxToText(new TextDecoder().decode(bytes));
}

export async function extractText(
  file: File,
  onProgress?: (progress: ScanProgress) => void,
): Promise<Extracted> {
  const name = baseName(file);

  if (DOCX.test(name)) {
    onProgress?.({ stage: 'Reading document', ratio: 0.3 });
    return { text: await readDocx(file), source: 'docx', confidence: 100 };
  }

  // A `.env` file usually has no MIME type at all, so the extension decides,
  // and an unknown type with no extension is worth trying as text before
  // giving up: it costs one read and beats refusing a perfectly good file.
  if (PLAIN.test(name) || file.type.startsWith('text/') || !/\.[a-z0-9]+$/i.test(name)) {
    onProgress?.({ stage: 'Reading file', ratio: 0.5 });
    return { text: await file.text(), source: 'plain', confidence: 100 };
  }

  const scan = await scanDocument(file, onProgress);
  return {
    text: scan.text,
    source: scan.source as TextSource,
    confidence: scan.confidence,
  };
}

/** For the file picker's `accept`, and for telling the user what to drop. */
export const ACCEPTED_DOCS =
  '.env,.txt,.md,.ini,.cfg,.conf,.config,.properties,.yaml,.yml,.json,.docx,.pdf,.png,.jpg,.jpeg,.webp';
