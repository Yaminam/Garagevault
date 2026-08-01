'use client';

/**
 * Spreadsheet import.
 *
 * The workbook is read, parsed, encrypted and posted as ciphertext entirely in
 * this tab. The file itself is never uploaded, and because the vault is already
 * unlocked there is no password prompt: the session key is right here.
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CheckCircle,
  FileXls,
  Table,
  UploadSimple,
  UsersThree,
  WarningCircle,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { buildItems } from '@/lib/sheet.ts';
import { buildPeople } from '@/lib/people-sheet.ts';
import { isCsv, readCsvAsWorkbook } from '@/lib/csv.ts';
import { readWorkbookFromFile } from '@/lib/xlsx-browser.ts';
import type { ItemFields } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';

/** Same identity rule the seeding script uses, so both stay in step. */
const identity = (item: { title: string; username: string | null; password: string | null }) =>
  `${item.title}|${item.username ?? ''}|${item.password ?? ''}`;

/**
 * Which parser to run.
 *
 * `auto` tries credentials then people, for the generic Tools entry point.
 * Opening from the People section already says what the file is, so it goes
 * straight to the roster parser and cannot silently read a credential sheet.
 */
export type ImportMode = 'auto' | 'people';

type Stage =
  | { kind: 'waiting' }
  | { kind: 'reading' }
  | { kind: 'preview'; fresh: ItemFields[]; duplicates: number; total: number; sheet: string }
  | { kind: 'writing' }
  | { kind: 'done'; written: number; duplicates: number }
  | { kind: 'failed'; message: string };

export function ImportDialog({
  mode = 'auto',
  onClose,
}: {
  mode?: ImportMode;
  onClose: () => void;
}) {
  const { items, importItems } = useVault();
  const [stage, setStage] = useState<Stage>({ kind: 'waiting' });
  const [dragging, setDragging] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const accept = useCallback(
    async (file: File) => {
      setStage({ kind: 'reading' });
      try {
        const sheets = isCsv(file)
          ? await readCsvAsWorkbook(file)
          : await readWorkbookFromFile(file);

        // In auto mode a workbook is either a credential tracker or an employee
        // roster, so try credentials first rather than making the user say
        // which they are holding. In people mode the caller already knows.
        let parsed: ItemFields[] = [];
        let sheet = '';

        if (mode === 'auto') {
          try {
            parsed = buildItems(sheets);
            sheet = sheets.find((s) => /credential/i.test(s.name))?.name ?? 'Credentials';
          } catch {
            // No credentials sheet, which is fine.
          }
        }

        if (parsed.length === 0) {
          const roster = buildPeople(sheets, 'Garage Collective');
          parsed = roster.people;
          sheet = roster.sheet;
        }

        if (parsed.length === 0) {
          setStage({
            kind: 'failed',
            message:
              mode === 'people'
                ? 'No employee rows found. The file needs a Name column at minimum. Check the expected columns below.'
                : 'No credential or employee rows found. Check the expected columns below and try again.',
          });
              return;
        }

        const seen = new Set(items.map(identity));
        const fresh = parsed.filter((item) => !seen.has(identity(item)));

        setStage({
          kind: 'preview',
          fresh,
          duplicates: parsed.length - fresh.length,
          total: parsed.length,
          sheet,
        });
      } catch (error) {
        setStage({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Could not read that file.',
        });
      }
    },
    [items, mode],
  );

  async function write(fresh: ItemFields[], duplicates: number) {
    setStage({ kind: 'writing' });
    try {
      const written = await importItems(fresh);
      setStage({ kind: 'done', written, duplicates });
    } catch (error) {
      setStage({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Could not save the entries.',
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-6">
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 cursor-default bg-bg/75 backdrop-blur-sm"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Import from spreadsheet"
        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        className="relative w-full max-w-[540px] overflow-hidden rounded-[12px] border border-line-strong bg-panel shadow-[var(--shadow-dialog)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            {mode === 'people' ? (
              <UsersThree size={15} weight="bold" />
            ) : (
              <FileXls size={15} weight="bold" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold tracking-tight text-ink">
              {mode === 'people' ? 'Upload employees' : 'Import from spreadsheet'}
            </p>
            <p className="text-[11.5px] text-ink-3">
              {mode === 'people'
                ? 'CSV or Excel, one row per person'
                : 'Credentials or an employee roster'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        <div className="px-5 py-5">
          {stage.kind === 'waiting' && (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) accept(file);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-[12px] border border-dashed px-6 py-8 text-center transition ${
                  dragging
                    ? 'border-accent/60 bg-accent/[0.06]'
                    : 'border-line hover:border-line-strong'
                }`}
              >
                <UploadSimple size={22} weight="bold" className="text-ink-3" />
                <p className="mt-3 text-[13.5px] text-ink">
                  {mode === 'people' ? 'Drop the employee list here' : 'Drop a spreadsheet here'}
                </p>
                <p className="mt-1 text-[12px] text-ink-3">
                  or click to choose an .xlsx or .csv file
                </p>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) accept(file);
                  }}
                />
              </label>

              <SheetFormat mode={mode} />
            </>
          )}

          {(stage.kind === 'reading' || stage.kind === 'writing') && (
            <div className="flex items-center gap-3 px-1 py-8">
              <span className="h-4 w-4 animate-spin rounded-full border-[2px] border-line-strong border-t-accent" />
              <p className="text-[13px] text-ink-2">
                {stage.kind === 'reading' ? 'Reading the workbook' : 'Encrypting and saving'}
              </p>
            </div>
          )}

          {stage.kind === 'preview' && (
            <>
              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[8px] border border-line bg-line">
                {[
                  { label: 'Rows found', value: stage.total },
                  { label: 'New', value: stage.fresh.length },
                  { label: 'Already here', value: stage.duplicates },
                ].map((stat) => (
                  <div key={stat.label} className="bg-panel px-3 py-2.5">
                    <dt className="label-caps">{stat.label}</dt>
                    <dd className="mt-1 font-mono text-[16px] text-ink">{stat.value}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-3 text-[12px] text-ink-3">
                From the {stage.sheet} sheet. Rows already in the vault are skipped, so importing
                twice is safe.
              </p>

              {stage.fresh.length > 0 && (
                <ul className="mt-4 max-h-[168px] space-y-px overflow-y-auto rounded-[8px] border border-line">
                  {stage.fresh.map((item, index) => (
                    <li
                      key={index}
                      className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-ink-3">
                        {item.password ? 'has password' : 'no password'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[8px] border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => write(stage.fresh, stage.duplicates)}
                  disabled={stage.fresh.length === 0}
                  className="rounded-[8px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {stage.fresh.length === 0
                    ? 'Nothing new to add'
                    : `Add ${stage.fresh.length} ${stage.fresh.length === 1 ? 'entry' : 'entries'}`}
                </button>
              </div>
            </>
          )}

          {stage.kind === 'done' && (
            <>
              <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-strong/30 bg-strong/10 text-strong">
                <CheckCircle size={19} weight="bold" />
              </span>
              <p className="mt-4 text-[15px] font-medium text-ink">
                Added {stage.written} {stage.written === 1 ? 'entry' : 'entries'}
              </p>
              <p className="mt-1.5 text-[12.5px] text-ink-2">
                {stage.duplicates > 0
                  ? `${stage.duplicates} were already in the vault and were left alone.`
                  : 'Everything from the sheet is now in the vault.'}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 w-full rounded-[8px] bg-accent px-4 py-2.5 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110"
              >
                Done
              </button>
            </>
          )}

          {stage.kind === 'failed' && (
            <>
              <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-weak/30 bg-weak/10 text-weak">
                <WarningCircle size={19} weight="bold" />
              </span>
              <p className="mt-4 text-[15px] font-medium text-ink">Import failed</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{stage.message}</p>
              <button
                type="button"
                onClick={() => setStage({ kind: 'waiting' })}
                className="mt-5 w-full rounded-[8px] border border-line px-4 py-2.5 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
              >
                Try another file
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * What the importer expects, written out so a failed import is diagnosable
 * without reading the parser.
 */
const CREDENTIAL_COLUMNS: { name: string; also?: string; note: string }[] = [
  { name: 'Password', note: 'Required. Its presence is what marks a header row.' },
  { name: 'Email Address', also: 'Login URL, Platform, Service', note: 'The thing being logged into.' },
  { name: 'Username / Login', also: 'Username, Login, User', note: 'Omit it and the email is used.' },
  { name: 'Account Type', also: 'Type', note: '“Copyloop (Project)” also sets the project.' },
  { name: '2FA Enabled', also: '2FA', note: 'Anything but “no” counts as enabled.' },
  { name: 'Entity', note: 'Falls back to Unassigned.' },
  { name: 'Notes', note: 'Alternate passwords here get flagged.' },
];

const PEOPLE_COLUMNS: { name: string; also?: string; note: string }[] = [
  { name: 'Name', also: 'Full Name, Employee Name', note: 'The only required column.' },
  { name: 'Employee ID', also: 'Emp Code, Staff ID', note: 'Generated when absent.' },
  { name: 'Email', also: 'Work Email, Official Email', note: 'Used to match allocations.' },
  { name: 'Department', also: 'Team, Dept, Function', note: 'Groups the rail.' },
  { name: 'Designation', also: 'Role, Title, Position', note: 'Titles with “lead” mark a team lead.' },
  { name: 'Reports To', also: 'Manager, Team Lead', note: 'Anyone named here becomes a lead.' },
  { name: 'Joining Date', also: 'DOJ, Start Date', note: 'Handles Excel serial dates.' },
  { name: 'Exit Date', also: 'LWD, Last Working Day', note: 'Filled in means marked as left.' },
];

function ColumnTable({ rows }: { rows: { name: string; also?: string; note: string }[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-[6px] border border-line">
      {rows.map((column) => (
        <div key={column.name} className="flex gap-3 border-b border-line px-2.5 py-2 last:border-b-0">
          <span className="w-[40%] shrink-0">
            <span className="block font-mono text-[11px] text-ink">{column.name}</span>
            {column.also && (
              <span className="block font-mono text-[10px] leading-tight text-ink-3">
                or {column.also}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-3">{column.note}</span>
        </div>
      ))}
    </div>
  );
}

function SheetFormat({ mode }: { mode: ImportMode }) {
  const [tab, setTab] = useState<'credentials' | 'people'>(
    mode === 'people' ? 'people' : 'credentials',
  );

  return (
    <details className="mt-4 rounded-[8px] border border-line bg-bg/40" open={mode === 'people'}>
      <summary className="flex cursor-pointer items-center gap-2 px-3.5 py-2.5 text-[12.5px] text-ink-2 hover:text-ink">
        <Table size={14} weight="bold" className="shrink-0 text-ink-3" />
        {mode === 'people' ? 'Columns it looks for' : 'What the sheet needs to look like'}
      </summary>

      <div className="border-t border-line px-3.5 py-3">
        {/* Opened from People, the credentials shape is not on offer. */}
        {mode === 'auto' && (
          <div className="mb-3 inline-flex rounded-[6px] border border-line bg-bg p-0.5">
            {(['credentials', 'people'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-[4px] px-2.5 py-1 text-[11.5px] font-medium capitalize transition ${
                  tab === t ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {tab === 'credentials' ? (
          <>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Read from the sheet whose tab name contains{' '}
              <span className="font-mono text-ink-2">Credentials</span>. Inside it, any number of
              stacked tables: a title row, a header row, then data, separated by a blank row.
              Column order does not matter and unknown columns are ignored.
            </p>
            <ColumnTable rows={CREDENTIAL_COLUMNS} />
            <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
              Cells reading <span className="font-mono">-</span>,{' '}
              <span className="font-mono">n/a</span> or{' '}
              <span className="font-mono">NOT PROVIDED</span> count as empty, and the row is
              flagged rather than silently blanked.
            </p>
          </>
        ) : (
          <>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Used when the workbook has no Credentials sheet. Prefers a tab named{' '}
              <span className="font-mono text-ink-2">Employees</span>,{' '}
              <span className="font-mono text-ink-2">People</span> or{' '}
              <span className="font-mono text-ink-2">Staff</span>, otherwise the first sheet with a
              recognisable header. One row per person.
            </p>
            <ColumnTable rows={PEOPLE_COLUMNS} />
            <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
              Anyone named in someone else’s “Reports To” is marked a team lead automatically, so
              the hierarchy does not have to be entered twice.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

export function ImportDialogHost({
  open,
  mode = 'auto',
  onClose,
}: {
  open: boolean;
  mode?: ImportMode;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && <ImportDialog key={`import-${mode}`} mode={mode} onClose={onClose} />}
    </AnimatePresence>
  );
}
