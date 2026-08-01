'use client';

/**
 * Drop a file, get an environment entry.
 *
 * Accepts `.env`, plain text, Word documents, PDFs and photos. Whatever comes
 * in is reduced to text in the tab and scanned for `KEY=value` lines, which is
 * the one shape every one of those formats can carry a credential in. Nothing
 * is uploaded.
 *
 * The extraction is never trusted silently. A `.env` file is exact, but a
 * photograph of a whiteboard is a guess, so the review step lists every key it
 * found and lets you drop the wrong ones before anything is encrypted. OCR
 * confidence is shown rather than hidden, because a key that lost one
 * character to a bad scan is worse than a key that was never imported.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CheckCircle,
  FileArrowUp,
  Lock,
  LockOpen,
  Warning,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { ACCEPTED_DOCS, extractText, type TextSource } from '@/lib/doc-text.ts';
import { parseEnvBlock } from '@/lib/env-templates.ts';
import { emptyEnv, type EnvVar } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';
import { useToast } from './primitives.tsx';

type Stage =
  | { kind: 'idle' }
  | { kind: 'reading'; label: string; ratio: number }
  | { kind: 'review' }
  | { kind: 'error'; message: string };

const SOURCE_LABEL: Record<TextSource, string> = {
  plain: 'read as text',
  docx: 'read from Word',
  'pdf-text': 'read from the PDF text layer',
  'pdf-scan': 'recognised from a scanned PDF',
  image: 'recognised from an image',
};

/** Anything below this and OCR has probably mangled a character somewhere. */
const SHAKY_CONFIDENCE = 80;

function titleFromFile(name: string): string {
  return (
    name
      .replace(/\.(download|crdownload|part)$/i, '')
      .replace(/\s*\(\d+\)/, '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/^\./, '')
      .trim() || 'Imported environment'
  );
}

export function EnvUploadDialog({
  projects,
  onClose,
}: {
  projects: string[];
  onClose: () => void;
}) {
  const { createItem } = useVault();
  const toast = useToast();
  const reduce = useReducedMotion();

  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [source, setSource] = useState<TextSource>('plain');
  const [confidence, setConfidence] = useState(100);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const take = useCallback(async (file: File) => {
    setStage({ kind: 'reading', label: 'Reading file', ratio: 0.1 });
    try {
      const result = await extractText(file, (progress) =>
        setStage({ kind: 'reading', label: progress.stage, ratio: progress.ratio }),
      );

      const found = parseEnvBlock(result.text);
      if (found.length === 0) {
        setStage({
          kind: 'error',
          message:
            'No KEY=value lines in that file. Environment entries are built from those, so there is nothing to import.',
        });
        return;
      }

      setVars(found);
      setDropped(new Set());
      setTitle(titleFromFile(file.name));
      setSource(result.source);
      setConfidence(result.confidence);
      setStage({ kind: 'review' });
    } catch (error) {
      setStage({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not read that file.',
      });
    }
  }, []);

  const keeping = vars.filter((_, index) => !dropped.has(index));

  const save = async () => {
    if (keeping.length === 0 || !title.trim()) return;
    setSaving(true);
    try {
      await createItem({
        ...emptyEnv(),
        title: title.trim(),
        vars: keeping,
        project: project.trim() || null,
        notes: `Imported from a file, ${SOURCE_LABEL[source]}.`,
      });
      toast.push(`${keeping.length} variables imported`);
      onClose();
    } catch (error) {
      setStage({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save the entry.',
      });
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 cursor-default bg-bg/70 backdrop-blur-[3px]"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Upload a file"
        initial={reduce ? false : { opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        className="relative flex max-h-[calc(100dvh-3rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-[12px] border border-line-strong bg-panel shadow-[var(--shadow-dialog)]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            <FileArrowUp size={15} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold tracking-tight text-ink">Upload a file</p>
            <p className="truncate text-[11.5px] text-ink-3">
              .env, text, Word, PDF or a photo
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {stage.kind === 'reading' ? (
            <div className="py-8 text-center">
              <p className="text-[13px] text-ink-2">{stage.label}</p>
              <div className="mx-auto mt-3 h-1 w-[220px] overflow-hidden rounded-full bg-line">
                <motion.div
                  animate={{ width: `${Math.round(stage.ratio * 100)}%` }}
                  transition={{ ease: 'easeOut', duration: 0.3 }}
                  className="h-full rounded-full bg-accent"
                />
              </div>
              <p className="mt-3 text-[11.5px] text-ink-3">
                Reading happens in this tab. The file is never uploaded.
              </p>
            </div>
          ) : stage.kind === 'review' ? (
            <Review
              vars={vars}
              dropped={dropped}
              onToggle={(index) =>
                setDropped((current) => {
                  const next = new Set(current);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
              title={title}
              onTitle={setTitle}
              project={project}
              onProject={setProject}
              projects={projects}
              source={source}
              confidence={confidence}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void take(file);
                }}
                className={`grid w-full place-items-center rounded-[10px] border border-dashed px-6 py-10 text-center transition ${
                  dragging
                    ? 'border-accent bg-accent/8'
                    : 'border-line-strong hover:border-accent/50 hover:bg-hover/40'
                }`}
              >
                <FileArrowUp size={26} weight="duotone" className="text-ink-3" />
                <p className="mt-3 text-[13px] font-medium text-ink-2">
                  Drop a file, or click to pick one
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                  Any `KEY=value` lines inside are pulled out. A scan or a photo
                  is read with OCR.
                </p>
              </button>

              {stage.kind === 'error' && (
                <p className="mt-4 flex items-start gap-2 rounded-[8px] border border-fair/25 bg-fair/10 px-3 py-2.5 text-[12px] leading-relaxed text-fair">
                  <Warning size={14} weight="bold" className="mt-px shrink-0" />
                  {stage.message}
                </p>
              )}
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_DOCS}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void take(file);
              event.target.value = '';
            }}
          />
        </div>

        {stage.kind === 'review' && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3.5">
            <span className="text-[11.5px] text-ink-3">
              {keeping.length} of {vars.length} will be saved
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStage({ kind: 'idle' })}
                className="rounded-[8px] border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
              >
                Back
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || keeping.length === 0 || !title.trim()}
                className="rounded-[8px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
              >
                {saving ? 'Saving' : 'Add to vault'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------- review ---- */

function Review({
  vars,
  dropped,
  onToggle,
  title,
  onTitle,
  project,
  onProject,
  projects,
  source,
  confidence,
}: {
  vars: EnvVar[];
  dropped: Set<number>;
  onToggle: (index: number) => void;
  title: string;
  onTitle: (value: string) => void;
  project: string;
  onProject: (value: string) => void;
  projects: string[];
  source: TextSource;
  confidence: number;
}) {
  const shaky = confidence < SHAKY_CONFIDENCE;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-2">Title</span>
          <input
            value={title}
            onChange={(event) => onTitle(event.target.value)}
            className="w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent/60"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-2">Project</span>
          <input
            value={project}
            onChange={(event) => onProject(event.target.value)}
            list="upload-projects"
            placeholder="Optional"
            className="w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60"
          />
          <datalist id="upload-projects">
            {projects.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </div>

      <p
        className={`mt-3 flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[11.5px] leading-relaxed ${
          shaky
            ? 'border-fair/25 bg-fair/10 text-fair'
            : 'border-line bg-raised/60 text-ink-3'
        }`}
      >
        {shaky ? (
          <Warning size={13} weight="bold" className="mt-px shrink-0" />
        ) : (
          <CheckCircle size={13} weight="bold" className="mt-px shrink-0 text-strong" />
        )}
        <span>
          {vars.length} variables {SOURCE_LABEL[source]}
          {confidence < 100 ? `, ${Math.round(confidence)}% confidence` : ''}.
          {shaky
            ? ' Check every value against the original before relying on it.'
            : ''}
        </span>
      </p>

      <ul className="mt-3 space-y-px">
        {vars.map((entry, index) => {
          const off = dropped.has(index);
          return (
            <li key={`${entry.key}-${index}`}>
              <button
                type="button"
                onClick={() => onToggle(index)}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-hover/60 ${
                  off ? 'opacity-45' : ''
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors ${
                    off ? 'border-line-strong' : 'border-accent bg-accent text-accent-ink'
                  }`}
                >
                  {!off && <CheckCircle size={11} weight="bold" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                  {entry.key}
                </span>
                {/* Values stay masked here. The point of the review is which
                    keys came through, not what they are. */}
                <span className="shrink-0 text-ink-3" title={entry.secret ? 'Masked as a secret' : 'Not a secret'}>
                  {entry.secret ? <Lock size={12} weight="bold" /> : <LockOpen size={12} weight="bold" />}
                </span>
                <span className="w-[54px] shrink-0 truncate text-right font-mono text-[11px] text-ink-3">
                  {entry.secret ? '•'.repeat(6) : entry.value.slice(0, 8) || 'empty'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function EnvUploadDialogHost({
  open,
  projects,
  onClose,
}: {
  open: boolean;
  projects: string[];
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && <EnvUploadDialog key="env-upload" projects={projects} onClose={onClose} />}
    </AnimatePresence>
  );
}
