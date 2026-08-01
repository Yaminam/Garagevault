/**
 * The XML half of the .xlsx reader, shared by the Node tool and the browser.
 *
 * An .xlsx is a ZIP of XML parts. Unzipping differs per platform (zlib in Node,
 * DecompressionStream in the browser) so callers hand this module the already
 * extracted parts; everything below is platform free.
 *
 * Deliberately no npm dependency: this repo handles credentials, so the smaller
 * the supply chain that touches plaintext, the better.
 */

export type Cell = string | null;
export type Sheet = { name: string; rows: Cell[][] };

/** Part name (for example `xl/workbook.xml`) to its decoded text. */
export type Parts = Map<string, string>;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    // Excel escapes control characters it cannot represent inline.
    .replace(/_x([0-9a-fA-F]{4})_/g, (m, h: string) => {
      const code = parseInt(h, 16);
      return code === 0x000d ? '\r' : code === 0x000a ? '\n' : m;
    });
}

/**
 * Match one element, self-closing or not.
 *
 * The lazy attribute group plus the `/>` alternative matters: a naive
 * `<c\b[^>]*>([\s\S]*?)<\/c>` treats `<c r="B25"/>` as an opening tag, and the
 * body then runs on to the next `</c>`, swallowing the following cells and
 * silently shifting every value in the row.
 *
 * Group 1 is the attributes, group 2 the body (undefined when self-closing).
 */
const element = (name: string) =>
  new RegExp(`<${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${name}>)`, 'g');

/** Concatenate the text of every <t> descendant of an XML fragment. */
function textOf(fragment: string): string {
  let out = '';
  const re = element('t');
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) out += decodeXml(m[2] ?? '');
  return out;
}

/** Column reference ("A", "AB") to a 1-based index. */
function colToIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * Turn extracted parts into sheets. Rows are dense; absent cells are `null`.
 */
export function parseWorkbook(parts: Parts): Sheet[] {
  const part = (name: string) => parts.get(name) ?? null;

  // Shared string table. Cells with t="s" hold an index into this.
  const shared: string[] = [];
  const ssXml = part('xl/sharedStrings.xml');
  if (ssXml) {
    const re = element('si');
    let m: RegExpExecArray | null;
    while ((m = re.exec(ssXml)) !== null) shared.push(m[2] ? textOf(m[2]) : '');
  }

  // Relationship id to part path.
  const rels = new Map<string, string>();
  for (const m of (part('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target);
  }

  const sheets: Sheet[] = [];

  for (const m of (part('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const target = rid ? rels.get(rid) : undefined;
    if (!target) continue;

    const sheetXml = part(target.replace(/^\/?(xl\/)?/, 'xl/'));
    if (!sheetXml) continue;

    const rows: Cell[][] = [];
    for (const rm of sheetXml.matchAll(element('row'))) {
      const cells = new Map<number, Cell>();
      let width = 0;

      for (const cm of (rm[2] ?? '').matchAll(element('c'))) {
        const attrs = cm[1] ?? '';
        const body = cm[2] ?? '';
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        if (!ref) continue;

        const idx = colToIndex(ref);
        if (idx > width) width = idx;

        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        let value: Cell = null;
        if (type === 's') {
          const i = parseInt(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1', 10);
          value = shared[i] ?? null;
        } else if (type === 'inlineStr') {
          value = textOf(body);
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          value = v == null ? null : decodeXml(v);
        }
        cells.set(idx, value);
      }

      const arr: Cell[] = new Array(width).fill(null);
      for (let i = 1; i <= width; i++) arr[i - 1] = cells.get(i) ?? null;
      rows.push(arr);
    }

    sheets.push({ name, rows });
  }

  return sheets;
}

/* ----------------------------------------------------------------- zip ---- */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

/** One entry located inside a ZIP archive. */
export type ZipEntry = { name: string; stored: boolean; start: number; size: number };

/**
 * Walk a ZIP central directory and report where each entry's bytes live.
 * Inflating them is left to the caller, since that is the platform-specific bit.
 */
export function readZipIndex(view: DataView): ZipEntry[] {
  // The End Of Central Directory record sits in the last 64KB, after a
  // variable-length comment, so scan backwards for its signature.
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= 0 && i >= view.byteLength - 65557; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('That file is not a valid .xlsx (no zip directory found).');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== CD_SIG) break;

    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + ptr + 46, nameLen));

    // The local header repeats name and extra with its own lengths; the central
    // directory's extra-field length does not apply here.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);

    entries.push({
      name,
      stored: method === 0,
      start: localOffset + 30 + lNameLen + lExtraLen,
      size: compressedSize,
    });

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Parts an .xlsx reader actually needs. Skipping the rest keeps this fast. */
export const isNeededPart = (name: string) =>
  name === 'xl/workbook.xml' ||
  name === 'xl/_rels/workbook.xml.rels' ||
  name === 'xl/sharedStrings.xml' ||
  name.startsWith('xl/worksheets/');
