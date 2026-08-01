/**
 * CSV reader.
 *
 * Written out rather than pulled from npm, for the same reason as the xlsx
 * reader: fewer dependencies touching credential data. Follows RFC 4180, so
 * quoted fields carrying commas, newlines and doubled quotes all survive, which
 * a `split(',')` would mangle the first time a name contained a comma.
 */

import type { Cell, Sheet } from './xlsx-core.ts';

/** Parse CSV text into rows. Handles quoted fields and both line endings. */
export function parseCsv(text: string): Cell[][] {
  // A byte order mark would otherwise become part of the first heading.
  const input = text.replace(/^﻿/, '');

  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip rows that are entirely empty, which trailing newlines produce.
    if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim() || null));
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (char === ',') {
      endField();
      i++;
      continue;
    }
    if (char === '\r') {
      // Handles CRLF and a bare CR.
      endRow();
      i += input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i++;
      continue;
    }

    field += char;
    i++;
  }

  // Whatever is left after the last delimiter is still a row.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

export const isCsv = (file: File | Blob) =>
  file.type === 'text/csv' ||
  file.type === 'application/csv' ||
  ('name' in file && typeof file.name === 'string' && /\.csv$/i.test(file.name));

/**
 * Read a CSV as a single-sheet workbook, so it can go through exactly the same
 * parsers the spreadsheet path uses.
 */
export async function readCsvAsWorkbook(file: File | Blob): Promise<Sheet[]> {
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('That CSV is empty.');

  // Named so the people parser prefers it, and the credentials parser can find
  // it when the headings say credentials instead.
  const name = 'name' in file && typeof file.name === 'string' ? file.name : 'Employees';
  return [{ name: /credential/i.test(name) ? name : `Employees (${name})`, rows }];
}
