/**
 * Garage Vault — spreadsheet -> item model.
 *
 * Only the Credentials sheet is read. It holds three stacked tables, each with a
 * different key column ("Email Address" / "Login URL" / "Platform") but the same
 * surrounding fields; this flattens all of them into one item shape.
 *
 * Pure functions — no I/O, no crypto. See import.ts for the pipeline.
 */

import type { Cell, Sheet } from './xlsx-core.ts';
import type { Category, CategoryId, ItemFields, ItemFlag } from './types.ts';

/* --------------------------------------------------------------- utils ---- */

/** Values the spreadsheet uses to mean "nothing here". */
const BLANKS = new Set(['', '-', '—', '–', '_', 'n/a', 'na', 'none', 'null']);

export function clean(value: Cell | undefined): string | null {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s || BLANKS.has(s.toLowerCase())) return null;
  return s;
}

/** `true` when the cell is a note saying the value is still missing. */
function isUnresolved(value: string | null): boolean {
  return value != null && /not provided|^\s*tbd\s*$|^\s*todo\s*$|^\s*unknown\s*$/i.test(value);
}

const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const isEmailAddress = (s: string | null): boolean =>
  s != null && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/* -------------------------------------------------------- sheet parsing ---- */

type Field = 'subject' | 'username' | 'password' | 'accountType' | 'twofa' | 'twofaContact' | 'entity' | 'notes';

const COLUMNS: Record<Field, string[]> = {
  subject: ['email address', 'login url', 'platform', 'service', 'site', 'account'],
  username: ['username / login', 'username', 'login', 'user', 'account name'],
  password: ['password', 'passphrase', 'secret'],
  accountType: ['account type', 'type'],
  twofa: ['2fa enabled', '2fa'],
  twofaContact: ['2fa contact', '2fa recovery'],
  entity: ['entity', 'company', 'org'],
  notes: ['notes', 'note', 'comments'],
};

type Header = Partial<Record<Field, number>>;

function resolveHeader(cells: Cell[]): Header {
  const map: Header = {};
  cells.forEach((cell, i) => {
    const key = clean(cell)?.toLowerCase();
    if (!key) return;
    for (const field of Object.keys(COLUMNS) as Field[]) {
      if (COLUMNS[field].includes(key) && map[field] === undefined) map[field] = i;
    }
  });
  return map;
}

/** A header row names a password column alongside at least two other fields. */
function isHeaderRow(cells: Cell[]): boolean {
  const map = resolveHeader(cells);
  return map.password !== undefined && Object.keys(map).length >= 3;
}

/** Banner rows we must not mistake for a section title. */
const BANNER = /confidential|do not share|restrict sharing|^⚠/i;

/**
 * Walk a sheet, yielding one entry per data row. A lone populated cell starts a
 * section; a header row opens a table; a fully blank row closes it.
 */
function* tables(rows: Cell[][]): Generator<{ section: string | null; header: Header; cells: Cell[] }> {
  let section: string | null = null;
  let header: Header | null = null;

  for (const row of rows) {
    const populated = row.filter((c) => clean(c) != null);

    if (populated.length === 0) {
      header = null;
      continue;
    }
    if (isHeaderRow(row)) {
      header = resolveHeader(row);
      continue;
    }
    if (!header && populated.length === 1 && clean(row[0]) != null) {
      const title = clean(row[0])!;
      if (!BANNER.test(title)) section = title;
      continue;
    }
    if (header) yield { section, header, cells: row };
  }
}

/* ---------------------------------------------------------- categorising -- */

export const CATEGORIES: (Category & { match: RegExp })[] = [
  { id: 'email', label: 'Email Accounts', icon: 'mail', match: /email accounts/i },
  { id: 'admin', label: 'Admin & CRM', icon: 'shield', match: /admin|crm|website|control panel/i },
  { id: 'social', label: 'Social Media', icon: 'share', match: /social/i },
  { id: 'database', label: 'Databases & Keys', icon: 'database', match: /database|infrastructure/i },
  { id: 'other', label: 'Other', icon: 'key', match: /$^/ },
];

function categoryFor(
  section: string | null,
  draft: { subject: string | null; username: string | null; notes: string | null },
): CategoryId {
  // Row-level signal wins: a bare "database password" row has no username and
  // names its backing store in the notes.
  const blob = `${draft.subject ?? ''} ${draft.notes ?? ''}`;
  if (!draft.username && /\bdatabase\b|\bsupabase\b|\bapi key\b|\bconnection string\b/i.test(blob)) {
    return 'database';
  }
  for (const c of CATEGORIES) if (section && c.match.test(section)) return c.id;
  return 'other';
}

/* ---------------------------------------------------------------- build ---- */

export function buildItems(sheets: Sheet[]): ItemFields[] {
  const credentials = sheets.find((s) => /credential/i.test(s.name));
  if (!credentials) throw new Error('No "Credentials" sheet found in the workbook.');

  const items: ItemFields[] = [];

  for (const { section, header, cells } of tables(credentials.rows)) {
    const at = (field: Field) => (header[field] === undefined ? null : clean(cells[header[field]!]));

    const subject = at('subject');
    const usernameCol = at('username');
    const passwordRaw = at('password');
    if (!subject && !usernameCol && !passwordRaw) continue;

    const url = subject && /^https?:\/\//i.test(subject) ? subject : null;
    const host = url ? hostOf(url) : null;
    const subjectIsEmail = isEmailAddress(subject);

    const flags: ItemFlag[] = [];

    let password = passwordRaw;
    if (isUnresolved(password)) {
      flags.push('password-unknown');
      password = null;
    }

    // The email-accounts table has no username column: the address is the login.
    let username = usernameCol ?? (subjectIsEmail ? subject : null);
    if (isUnresolved(username)) {
      flags.push('username-unknown');
      username = null;
    }

    const notes = at('notes');
    const category = categoryFor(section, { subject, username, notes });

    const title = host ?? (subjectIsEmail ? subject! : titleCase(subject ?? username ?? 'Untitled'));

    // The tracker sometimes parks an unresolved alternate password in the notes.
    const alternates = [...(notes ?? '').matchAll(/alternate passwords?[^:]*:\s*([^.(]+)/gi)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    if (alternates.length) flags.push('ambiguous-password');
    if (!password) flags.push('no-password');

    const accountType = at('accountType');
    const email = subjectIsEmail ? subject : isEmailAddress(username) ? username : null;

    items.push({
      kind: 'login',
      title,
      // Account types are written as "Copyloop (Project)" in the sheet.
      project: /^(.*?)\s*\(project\)$/i.exec(accountType ?? '')?.[1]?.trim() ?? null,
      // The sheet records no owner name, so the login address is the best signal.
      owner: { name: null, email },
      entity: at('entity') ?? 'Unassigned',
      notes,
      username,
      password,
      alternates,
      url,
      email,
      category,
      accountType,
      twofa: at('twofa'),
      twofaContact: at('twofaContact'),
      provider: null,
      vars: [],
      billing: null,
      asset: null,
      org: null,
      person: null,
      section: section ?? 'Credentials',
      flags: [...new Set(flags)],
    });
  }

  return items;
}
