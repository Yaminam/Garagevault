/**
 * Employee spreadsheet -> person entries.
 *
 * Deliberately forgiving about headings, because an HR export never uses the
 * exact words you would pick. It needs a name and nothing else; every other
 * column is optional and simply skipped when absent.
 */

import type { Cell, Sheet } from './xlsx-core.ts';
import { emptyPerson, nextEmployeeId, type ItemFields } from './types.ts';

const BLANKS = new Set(['', '-', '—', '–', 'n/a', 'na', 'none', 'null', 'nil']);

function clean(value: Cell | undefined): string | null {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s || BLANKS.has(s.toLowerCase())) return null;
  return s;
}

type Field =
  | 'fullName' | 'employeeId' | 'workEmail' | 'personalEmail' | 'phone'
  | 'department' | 'designation' | 'reportsTo' | 'employmentType'
  | 'joinedOn' | 'exitedOn' | 'location' | 'entity';

const COLUMNS: Record<Field, string[]> = {
  fullName: ['name', 'full name', 'employee name', 'employee', 'staff name', 'member'],
  employeeId: ['employee id', 'emp id', 'id', 'employee code', 'emp code', 'staff id'],
  workEmail: ['email', 'work email', 'official email', 'company email', 'email address', 'work mail'],
  personalEmail: ['personal email', 'private email', 'alternate email'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number', 'contact number'],
  department: ['department', 'dept', 'team', 'function', 'division'],
  designation: ['designation', 'role', 'title', 'job title', 'position'],
  reportsTo: ['reports to', 'reporting to', 'manager', 'team lead', 'lead', 'supervisor', 'reporting manager'],
  employmentType: ['employment type', 'type', 'employment', 'contract type', 'engagement'],
  joinedOn: ['joining date', 'date of joining', 'joined', 'start date', 'doj'],
  exitedOn: ['exit date', 'last working day', 'lwd', 'relieving date', 'end date'],
  location: ['location', 'office', 'base', 'city', 'work location'],
  entity: ['entity', 'company', 'organisation', 'organization', 'legal entity'],
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

/** A header row must name a person somehow. Everything else is optional. */
const isHeaderRow = (cells: Cell[]) => resolveHeader(cells).fullName !== undefined;

/** Excel serial dates count days from 1899-12-30. */
function toIsoDate(value: string | null): string | null {
  if (!value) return null;

  if (/^\d{5}$/.test(value)) {
    const ms = (Number(value) - 25569) * 86_400_000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const dmy = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(value);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    // Ambiguous unless one part cannot be a month. Indian sheets are day-first.
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    if (day <= 31 && month <= 12) {
      return `${dmy[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const isEmail = (s: string | null) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export type PeopleImport = {
  people: ItemFields[];
  /** Sheet the rows came from, for the confirmation screen. */
  sheet: string;
  /** Rows skipped for having no name at all. */
  skipped: number;
};

export function buildPeople(sheets: Sheet[], defaultEntity: string): PeopleImport {
  // Prefer a sheet that names itself, else the first with a usable header.
  const named = sheets.find((s) => /employee|people|staff|team|roster|hr/i.test(s.name));
  const candidates = named ? [named, ...sheets.filter((s) => s !== named)] : sheets;

  for (const sheet of candidates) {
    const headerAt = sheet.rows.findIndex(isHeaderRow);
    if (headerAt === -1) continue;

    const header = resolveHeader(sheet.rows[headerAt]);
    const people: ItemFields[] = [];
    const ids: (string | null)[] = [];
    let skipped = 0;

    for (const row of sheet.rows.slice(headerAt + 1)) {
      const at = (field: Field) =>
        header[field] === undefined ? null : clean(row[header[field]!]);

      const fullName = at('fullName');
      if (!fullName) {
        // A blank row inside the table is normal; only count rows with content.
        if (row.some((c) => clean(c) != null)) skipped++;
        continue;
      }

      const employeeId = at('employeeId') ?? nextEmployeeId(ids);
      ids.push(employeeId);

      const blank = emptyPerson(employeeId);
      const workEmail = at('workEmail');
      const reportsTo = at('reportsTo');
      const exitedOn = toIsoDate(at('exitedOn'));

      people.push({
        ...blank,
        title: fullName,
        entity: at('entity') ?? defaultEntity,
        owner: { name: fullName, email: isEmail(workEmail) ? workEmail : null },
        person: {
          ...blank.person!,
          fullName,
          employeeId,
          workEmail: isEmail(workEmail) ? workEmail : null,
          personalEmail: (() => {
            const p = at('personalEmail');
            return isEmail(p) ? p : null;
          })(),
          phone: at('phone'),
          department: at('department'),
          designation: at('designation'),
          reportsTo,
          employmentType: at('employmentType') ?? 'Full time',
          joinedOn: toIsoDate(at('joinedOn')),
          exitedOn,
          location: at('location'),
          // Someone with a leaving date is not on the team any more, whatever
          // the rest of the row says.
          active: exitedOn == null,
        },
      });
    }

    if (people.length > 0) {
      return { people: markTeamLeads(people), sheet: sheet.name, skipped };
    }
  }

  return { people: [], sheet: '', skipped: 0 };
}

/**
 * Anyone named as someone else's manager is a team lead, so the rail can group
 * people under them without asking for it to be filled in twice.
 */
function markTeamLeads(people: ItemFields[]): ItemFields[] {
  const named = new Set(
    people
      .map((p) => p.person?.reportsTo?.trim().toLowerCase())
      .filter((v): v is string => !!v),
  );

  return people.map((p) => {
    const person = p.person!;
    const isLead =
      (!!person.fullName && named.has(person.fullName.toLowerCase())) ||
      (!!person.workEmail && named.has(person.workEmail.toLowerCase())) ||
      /lead|head|manager|director|founder|chief|cto|ceo|coo/i.test(person.designation ?? '');
    return isLead ? { ...p, person: { ...person, isTeamLead: true } } : p;
  });
}
