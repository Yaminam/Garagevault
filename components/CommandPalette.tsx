'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowElbowDownLeft,
  Barcode as BarcodeIcon,
  Bug,
  FileText,
  FileXls,
  Key,
  LockKey,
  MagnifyingGlass,
  Plus,
  Pulse,
  ChartLineUp,
  Receipt,
  Sparkle,
} from '@phosphor-icons/react/dist/ssr';
import type { ItemKind, VaultItem } from '@/lib/types.ts';
import { Monogram } from './primitives.tsx';

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: 'Entries' | 'Create' | 'Go to' | 'Session';
  icon: React.ReactNode;
  run: () => void;
};

type Props = {
  open: boolean;
  items: VaultItem[];
  onClose: () => void;
  onOpenItem: (id: string) => void;
  onNew: (kind: ItemKind) => void;
  onImport: () => void;
  onView: (view: 'health' | 'generator' | 'spend') => void;
  onLock: () => void;
  /** Development only, for eyeballing the error screen. */
  onCrash: () => void;
};

export function CommandPalette({
  open,
  items,
  onClose,
  onOpenItem,
  onNew,
  onImport,
  onView,
  onLock,
  onCrash,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const needle = query.trim().toLowerCase();

    const actions: Command[] = [
      {
        id: 'new-login',
        label: 'New login',
        hint: 'Username and password',
        group: 'Create',
        icon: <Plus size={15} weight="bold" />,
        run: () => onNew('login'),
      },
      {
        id: 'new-env',
        label: 'New environment',
        hint: 'A set of KEY=value pairs',
        group: 'Create',
        icon: <FileText size={15} weight="bold" />,
        run: () => onNew('env'),
      },
      {
        id: 'new-billing',
        label: 'New bill',
        hint: 'A subscription or invoice, scannable',
        group: 'Create',
        icon: <Receipt size={15} weight="bold" />,
        run: () => onNew('billing'),
      },
      {
        id: 'new-asset',
        label: 'New asset',
        hint: 'Generates a tag, barcode and QR label',
        group: 'Create',
        icon: <BarcodeIcon size={15} weight="bold" />,
        run: () => onNew('asset'),
      },
      {
        id: 'import',
        label: 'Import from spreadsheet',
        hint: 'Reads the Credentials sheet',
        group: 'Create',
        icon: <FileXls size={15} weight="bold" />,
        run: onImport,
      },
      {
        id: 'health',
        label: 'Security review',
        group: 'Go to',
        icon: <Pulse size={15} weight="bold" />,
        run: () => onView('health'),
      },
      {
        id: 'spend',
        label: 'Spend breakdown',
        group: 'Go to',
        icon: <ChartLineUp size={15} weight="bold" />,
        run: () => onView('spend'),
      },
      {
        id: 'generator',
        label: 'Generator',
        group: 'Go to',
        icon: <Sparkle size={15} weight="bold" />,
        run: () => onView('generator'),
      },
      {
        id: 'lock',
        label: 'Lock the vault',
        hint: 'Ctrl L',
        group: 'Session',
        icon: <LockKey size={15} weight="bold" />,
        run: onLock,
      },
    ];

    // Stripped from production builds: the condition is a compile-time constant,
    // so the entry cannot reach a real deployment.
    if (process.env.NODE_ENV === 'development') {
      actions.push({
        id: 'crash',
        label: 'Trigger a test error',
        hint: 'Development only, shows the error screen',
        group: 'Session',
        icon: <Bug size={15} weight="bold" />,
        run: onCrash,
      });
    }

    // Entries rank above actions when the query looks like a search, because
    // that is overwhelmingly what someone opens this for.
    const entries: Command[] = items
      .filter((item) => {
        if (!needle) return false;
        return [item.title, item.username, item.project, item.entity, item.owner?.name]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle));
      })
      .slice(0, 7)
      .map((item) => ({
        id: `item-${item.id}`,
        label: item.title,
        hint: item.username ?? item.project ?? item.entity,
        group: 'Entries' as const,
        icon: item.kind === 'env' ? <FileText size={15} weight="bold" /> : <Key size={15} weight="bold" />,
        run: () => onOpenItem(item.id),
      }));

    const matched = needle
      ? actions.filter((action) =>
          `${action.label} ${action.hint ?? ''}`.toLowerCase().includes(needle),
        )
      : actions;

    return [...entries, ...matched];
  }, [query, items, onNew, onImport, onView, onLock, onCrash, onOpenItem]);

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((c) => Math.min(commands.length - 1, c + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const command = commands[cursor];
        if (command) {
          command.run();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, commands, cursor, onClose]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Group headings are rendered inline, so track where each group starts.
  let lastGroup: string | null = null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
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
            aria-label="Command palette"
            initial={reduce ? false : { opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            className="lift relative w-full max-w-[560px] overflow-hidden rounded-[12px] border border-line-strong bg-panel"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <MagnifyingGlass size={16} weight="bold" className="shrink-0 text-ink-3" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder="Search entries, or jump to an action"
                aria-label="Search entries and actions"
                spellCheck={false}
                className="w-full bg-transparent py-3.5 text-[14px] text-ink outline-none placeholder:text-ink-3"
              />
              <kbd className="shrink-0 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                Esc
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
              {commands.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13px] text-ink-3">
                  Nothing matches that.
                </p>
              ) : (
                commands.map((command, index) => {
                  const heading = command.group !== lastGroup ? command.group : null;
                  lastGroup = command.group;
                  const active = index === cursor;

                  return (
                    <div key={command.id}>
                      {heading && <p className="label-caps px-3 pb-1 pt-3 first:pt-1">{heading}</p>}
                      <button
                        type="button"
                        data-index={index}
                        onMouseMove={() => setCursor(index)}
                        onClick={() => {
                          command.run();
                          onClose();
                        }}
                        className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left transition-colors ${
                          active ? 'bg-hover' : ''
                        }`}
                      >
                        {command.group === 'Entries' ? (
                          <Monogram label={command.label} size="sm" active={active} />
                        ) : (
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border ${
                              active
                                ? 'border-accent/40 bg-accent/12 text-accent'
                                : 'border-line bg-raised text-ink-3'
                            }`}
                          >
                            {command.icon}
                          </span>
                        )}

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{command.label}</span>
                          {command.hint && (
                            <span className="block truncate text-[11.5px] text-ink-3">
                              {command.hint}
                            </span>
                          )}
                        </span>

                        {active && (
                          <ArrowElbowDownLeft size={13} weight="bold" className="shrink-0 text-ink-3" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
