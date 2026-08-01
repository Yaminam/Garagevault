'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FolderSimplePlus, X } from '@phosphor-icons/react/dist/ssr';

/**
 * A project is only a label, so creating one is deliberately lightweight: no
 * row, no encryption, nothing to clean up if it turns out to be a typo.
 */
export function AddProjectDialog({
  existing,
  onCreate,
  onClose,
}: {
  existing: string[];
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = name.trim();
  const clash = existing.some((p) => p.toLowerCase() === trimmed.toLowerCase());
  const ready = trimmed.length >= 2 && !clash;

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

      <motion.form
        role="dialog"
        aria-modal="true"
        aria-label="Add a project"
        initial={reduce ? false : { opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            onCreate(trimmed);
            onClose();
          }
        }}
        className="lift relative w-full max-w-[400px] overflow-hidden rounded-[12px] border border-line-strong bg-panel"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            <FolderSimplePlus size={15} weight="bold" />
          </span>
          <p className="flex-1 text-[14px] font-semibold tracking-tight text-ink">Add a project</p>
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
          <label htmlFor="project-name" className="mb-1.5 block text-[12px] font-medium text-ink-2">
            Name
          </label>
          <input
            ref={inputRef}
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Copyloop"
            className="w-full rounded-[8px] border border-line bg-bg px-3 py-2.5 text-[13.5px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60"
          />
          <p className={`mt-1.5 text-[11.5px] ${clash ? 'text-fair' : 'text-ink-3'}`}>
            {clash
              ? 'A project with that name already exists.'
              : 'Logins and environment files both file under a project.'}
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready}
              className="rounded-[8px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            >
              Create
            </button>
          </div>
        </div>
      </motion.form>
    </div>
  );
}

export function AddProjectDialogHost({
  open,
  existing,
  onCreate,
  onClose,
}: {
  open: boolean;
  existing: string[];
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <AddProjectDialog key="add-project" existing={existing} onCreate={onCreate} onClose={onClose} />
      )}
    </AnimatePresence>
  );
}
