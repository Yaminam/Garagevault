'use client';

/**
 * Bulk invoice import.
 *
 * Point it at a folder and it reads every PDF and image in one pass, turning
 * each into a billing entry. The reading is the same local Tesseract and pdf.js
 * path a single scan uses, so nothing is uploaded, and each file becomes a row
 * you can check and untick before anything is written.
 *
 * Files are read one at a time on purpose. OCR spins up a WASM worker per call,
 * and a folder of twenty scans would otherwise try to run twenty at once and
 * exhaust memory. A text PDF returns almost instantly, so sequential is fine.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CheckCircle,
  FolderOpen,
  Receipt,
  WarningCircle,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { applyInvoice } from '@/lib/billing.ts';
import { isPdf } from '@/lib/pdf.ts';
import { scanDocument } from '@/lib/ocr.ts';
import type { ItemFields } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';

const isInvoiceFile = (file: File) =>
  isPdf(file) || file.type.startsWith('image/') || /\.(pdf|png|jpe?g|webp|tiff?)$/i.test(file.name);

type Row = {
  id: number;
  fileName: string;
  status: 'queued' | 'reading' | 'done' | 'failed';
  include: boolean;
  fields: ItemFields | null;
  confidence: number;
  error: string | null;
};

type Stage =
  | { kind: 'pick' }
  | { kind: 'scanning'; done: number; total: number }
  | { kind: 'review' }
  | { kind: 'writing' }
  | { kind: 'done'; written: number };

export function BulkInvoices({ onClose }: { onClose: () => void }) {
  const { importItems } = useVault();
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const reduce = useReducedMotion();
  const cancelled = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled.current = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function scanAll(files: File[]) {
    const invoices = files.filter(isInvoiceFile);
    if (invoices.length === 0) {
      setStage({ kind: 'review' });
      setRows([]);
      return;
    }

    // Seed the list so the user watches it fill in, rather than staring at a
    // spinner for a folder that might take a minute.
    const seeded: Row[] = invoices.map((file, i) => ({
      id: i,
      fileName: file.name,
      status: 'queued',
      include: true,
      fields: null,
      confidence: 0,
      error: null,
    }));
    setRows(seeded);
    setStage({ kind: 'scanning', done: 0, total: invoices.length });

    for (let i = 0; i < invoices.length; i++) {
      if (cancelled.current) return;

      setRows((current) => current.map((r) => (r.id === i ? { ...r, status: 'reading' } : r)));

      try {
        const result = await scanDocument(invoices[i]);
        const fields = applyInvoice(result.invoice);
        // A read that found no vendor and no amount is not worth importing.
        const empty = !fields.billing?.vendor && fields.billing?.amount == null;

        setRows((current) =>
          current.map((r) =>
            r.id === i
              ? {
                  ...r,
                  status: empty ? 'failed' : 'done',
                  include: !empty,
                  fields,
                  confidence: result.confidence,
                  error: empty ? 'Could not read a vendor or amount' : null,
                }
              : r,
          ),
        );
      } catch (error) {
        setRows((current) =>
          current.map((r) =>
            r.id === i
              ? {
                  ...r,
                  status: 'failed',
                  include: false,
                  error: error instanceof Error ? error.message : 'Could not read this file',
                }
              : r,
          ),
        );
      }

      setStage({ kind: 'scanning', done: i + 1, total: invoices.length });
    }

    if (!cancelled.current) setStage({ kind: 'review' });
  }

  async function write() {
    const chosen = rows.filter((r) => r.include && r.fields).map((r) => r.fields!);
    if (chosen.length === 0) return;
    setStage({ kind: 'writing' });
    try {
      const written = await importItems(chosen);
      setStage({ kind: 'done', written });
    } catch (error) {
      setRows((current) =>
        current.map((r) =>
          r.include ? { ...r, status: 'failed', error: error instanceof Error ? error.message : 'Write failed' } : r,
        ),
      );
      setStage({ kind: 'review' });
    }
  }

  const readable = rows.filter((r) => r.fields);
  const included = rows.filter((r) => r.include && r.fields).length;

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
        aria-label="Import invoices from a folder"
        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        className="lift relative flex max-h-[calc(100dvh-3rem)] w-full max-w-[620px] flex-col overflow-hidden rounded-[12px] border border-line-strong bg-panel"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            <Receipt size={15} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold tracking-tight text-ink">Import a folder of invoices</p>
            <p className="text-[11.5px] text-ink-3">Read in this tab, nothing is uploaded</p>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {stage.kind === 'pick' && (
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
                  scanAll([...e.dataTransfer.files]);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-[12px] border border-dashed px-6 py-10 text-center transition ${
                  dragging ? 'border-accent/60 bg-accent/[0.06]' : 'border-line hover:border-line-strong'
                }`}
              >
                <FolderOpen size={22} weight="bold" className="text-ink-3" />
                <p className="mt-3 text-[13.5px] text-ink">Choose a folder of invoices</p>
                <p className="mt-1 text-[12px] text-ink-3">or drop files here</p>
                <input
                  type="file"
                  // webkitdirectory selects a whole folder; the multiple/accept
                  // fallback covers browsers or drops that hand over loose files.
                  // @ts-expect-error non-standard but supported in Chromium, Safari, Firefox
                  webkitdirectory=""
                  directory=""
                  multiple
                  className="sr-only"
                  onChange={(e) => e.target.files && scanAll([...e.target.files])}
                />
              </label>

              <label className="mt-3 flex cursor-pointer items-center justify-center rounded-[8px] border border-line px-3 py-2 text-[12.5px] text-ink-2 transition hover:border-line-strong hover:text-ink">
                Pick individual files instead
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => e.target.files && scanAll([...e.target.files])}
                />
              </label>

              <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                Every PDF and image in the folder becomes a billing entry. Text PDFs are read
                exactly; scans and photos go through OCR, which is slower. You review the list
                before anything is saved.
              </p>
            </>
          )}

          {(stage.kind === 'scanning' || stage.kind === 'review' || stage.kind === 'writing') && (
            <>
              {stage.kind === 'scanning' && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-[12px] text-ink-2">
                    <span>Reading invoices</span>
                    <span className="font-mono">
                      {stage.done} / {stage.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-strong">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${(stage.done / stage.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {rows.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-ink-3">
                  No PDFs or images in that selection.
                </p>
              ) : (
                <div className="overflow-hidden rounded-[8px] border border-line">
                  {rows.map((row) => (
                    <label
                      key={row.id}
                      className={`flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 ${
                        row.fields ? 'cursor-pointer' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={row.include}
                        disabled={!row.fields || stage.kind !== 'review'}
                        onChange={(e) =>
                          setRows((current) =>
                            current.map((r) => (r.id === row.id ? { ...r, include: e.target.checked } : r)),
                          )
                        }
                        className="h-4 w-4 shrink-0 accent-accent disabled:opacity-40"
                      />

                      <span className="min-w-0 flex-1">
                        {row.fields ? (
                          <>
                            <span className="block truncate text-[12.5px] text-ink">
                              {row.fields.title || row.fileName}
                            </span>
                            <span className="block truncate text-[11px] text-ink-3">
                              {row.fields.billing?.amount != null
                                ? `${row.fields.billing.currency} ${row.fields.billing.amount.toLocaleString()}`
                                : 'No amount'}
                              {row.fields.billing?.paidOn ? ` · ${row.fields.billing.paidOn}` : ''}
                              {row.fields.billing?.invoiceNumber
                                ? ` · ${row.fields.billing.invoiceNumber}`
                                : ''}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="block truncate text-[12.5px] text-ink-2">{row.fileName}</span>
                            <span className="block truncate text-[11px] text-ink-3">
                              {row.error ?? (row.status === 'reading' ? 'Reading…' : 'Queued')}
                            </span>
                          </>
                        )}
                      </span>

                      <span className="shrink-0">
                        {row.status === 'reading' && (
                          <span className="block h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-line-strong border-t-accent" />
                        )}
                        {row.status === 'done' && (
                          <CheckCircle size={15} weight="bold" className="text-strong" />
                        )}
                        {row.status === 'failed' && (
                          <WarningCircle size={15} weight="bold" className="text-fair" />
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {stage.kind === 'done' && (
            <div className="py-4">
              <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-strong/30 bg-strong/10 text-strong">
                <CheckCircle size={19} weight="bold" />
              </span>
              <p className="mt-4 text-[15px] font-medium text-ink">
                Added {stage.written} {stage.written === 1 ? 'bill' : 'bills'}
              </p>
              <p className="mt-1.5 text-[12.5px] text-ink-2">
                Open Billing to check the amounts against the originals.
              </p>
            </div>
          )}
        </div>

        {(stage.kind === 'review' || stage.kind === 'writing' || stage.kind === 'done') && (
          <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3.5">
            {stage.kind === 'review' && readable.length > 0 && (
              <p className="text-[12px] text-ink-3">
                {included} of {readable.length} selected
              </p>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[8px] border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
              >
                {stage.kind === 'done' ? 'Close' : 'Cancel'}
              </button>
              {stage.kind !== 'done' && (
                <button
                  type="button"
                  onClick={write}
                  disabled={stage.kind === 'writing' || included === 0}
                  className="rounded-[8px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {stage.kind === 'writing'
                    ? 'Saving'
                    : `Add ${included} ${included === 1 ? 'bill' : 'bills'}`}
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export function BulkInvoicesHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>{open && <BulkInvoices key="bulk-invoices" onClose={onClose} />}</AnimatePresence>
  );
}
