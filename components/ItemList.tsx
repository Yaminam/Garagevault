'use client';

import { Fragment, useEffect, useMemo, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Barcode,
  FileText,
  MagnifyingGlass,
  Plus,
  Receipt,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { scorePassword } from '@/lib/audit.ts';
import { ASSET_CATEGORY_LABEL } from '@/lib/assets.ts';
import { brandMarkForItem } from '@/lib/brand-marks.ts';
import type { VaultItem } from '@/lib/types.ts';
import { BrandTile, Monogram, tileClass } from './primitives.tsx';

/**
 * Strength is shown as a dot rather than a bar because the list is scanned,
 * not read. The halo is the same hue at low alpha, which lifts a 6px mark off
 * the row without making it larger or louder than the title it belongs to.
 */
const VERDICT_DOT = {
  critical: 'bg-weak ring-weak/25',
  weak: 'bg-weak ring-weak/25',
  fair: 'bg-fair ring-fair/25',
  strong: 'bg-strong ring-strong/25',
} as const;

type Props = {
  items: VaultItem[];
  selectedId: string | null;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Present when the current section can be bulk-filled from a file. */
  onUpload?: { label: string; run: () => void };
};

export function ItemList({
  items,
  selectedId,
  query,
  searchRef,
  onQuery,
  onSelect,
  onNew,
  onUpload,
}: Props) {
  const reduce = useReducedMotion();

  // Keyboard navigation moves the selection; keep it inside the scroll port.
  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector(`[data-item-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // Every kind sits together under whatever is being viewed, separated only by
  // a heading, so a project reads as one thing. Built from the full kind list
  // rather than named individually: leaving one out silently hides those rows.
  const groups = useMemo(() => {
    const headings: Record<VaultItem['kind'], string> = {
      login: 'Logins',
      env: 'Environment files',
      billing: 'Billing',
      asset: 'Assets',
      person: 'People',
      org: 'Organisation',
    };
    // Bills read best newest-first by their date; everything else stays A to Z.
    const billingDate = (i: VaultItem) =>
      i.billing?.paidOn ?? i.billing?.nextRenewal ?? '';
    const ordered = (kind: VaultItem['kind'], list: VaultItem[]) =>
      kind === 'billing'
        ? [...list].sort(
            (a, b) =>
              billingDate(b).localeCompare(billingDate(a)) || a.title.localeCompare(b.title),
          )
        : list;

    return (Object.keys(headings) as VaultItem['kind'][])
      .map((kind) => [headings[kind], ordered(kind, items.filter((i) => i.kind === kind))] as const)
      .filter(([, list]) => list.length > 0);
  }, [items]);

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="shrink-0 border-b border-line p-2">
        <div className="flex items-center gap-2 rounded-[8px] border border-line bg-bg px-2.5 focus-within:border-accent/50">
          <MagnifyingGlass size={14} weight="bold" className="shrink-0 text-ink-3" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Filter this list"
            aria-label="Filter the list"
            spellCheck={false}
            className="w-full bg-transparent py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery('')}
              aria-label="Clear filter"
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
            >
              <X size={12} weight="bold" />
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div className="max-w-[240px]">
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[11px] border border-line bg-raised text-ink-3">
              {query ? <MagnifyingGlass size={19} weight="bold" /> : <Plus size={19} weight="bold" />}
            </div>
            <p className="text-[14px] font-medium text-ink-2">
              {query ? 'Nothing matches' : 'Nothing here yet'}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
              {query
                ? 'Try a shorter term, or clear the filter in the left rail.'
                : 'Add a login or an environment file to get started.'}
            </p>
            {!query && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={onNew}
                  className="rounded-[8px] border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
                >
                  New entry
                </button>
                {onUpload && (
                  <button
                    type="button"
                    onClick={onUpload.run}
                    className="flex items-center gap-1.5 rounded-[8px] bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px"
                  >
                    <UploadSimple size={13} weight="bold" />
                    {onUpload.label}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {groups.map(([heading, list]) => (
            <Fragment key={heading}>
              {groups.length > 1 && (
                <li className="sticky top-0 z-10 -mx-1.5 flex items-center gap-2.5 bg-bg/92 px-4 py-2 backdrop-blur">
                  <span className="label-caps">{heading}</span>
                  {/* The rule earns the heading its own register, so a group
                      break reads as structure instead of one more row. */}
                  <span className="h-px flex-1 bg-line" aria-hidden />
                  <span className="font-mono text-[10px] tabular-nums text-ink-3">
                    {list.length}
                  </span>
                </li>
              )}
              {list.map((item, index) => {
                const active = item.id === selectedId;
                const score = item.password ? scorePassword(item.password) : null;
                const mark = brandMarkForItem(item);

                return (
                  <motion.li
                    key={item.id}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(index * 0.012, 0.16) }}
                  >
                    {/*
                      Selection lifts the row onto its own surface rather than
                      just tinting it. That reads correctly in both themes for
                      the same reason: `raised` is always the step toward the
                      viewer, so the active row is a white card on grey by day
                      and a lit slab on black by night. A flat tint would have
                      needed opposite directions. The transparent border is
                      held in place at rest so gaining one shifts nothing.
                    */}
                    <button
                      type="button"
                      data-item-id={item.id}
                      onClick={() => onSelect(item.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`relative flex w-full items-center gap-3 rounded-[8px] border py-2 pl-3 pr-2.5 text-left transition-colors
                        ${active
                          ? 'border-line bg-raised shadow-[var(--shadow-row)]'
                          : 'border-transparent hover:bg-hover/60'
                        }`}
                    >
                      {active && (
                        <motion.span
                          layoutId={reduce ? undefined : 'row-marker'}
                          transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                          className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent"
                        />
                      )}

                      {/* A real logo when the service is one we recognise, the
                          monogram when it is not, the kind glyph for rows that
                          are not a service at all. */}
                      {mark ? (
                        <BrandTile mark={mark} active={active} />
                      ) : item.kind === 'login' || item.kind === 'person' ? (
                        <Monogram label={item.title} active={active} />
                      ) : (
                        <span className={tileClass('md', active)}>
                          {item.kind === 'env' ? (
                            <FileText size={15} weight="bold" />
                          ) : item.kind === 'billing' ? (
                            <Receipt size={15} weight="bold" />
                          ) : (
                            <Barcode size={15} weight="bold" />
                          )}
                        </span>
                      )}

                      <span className="min-w-0 flex-1">
                        {/* The selected title carries a touch more weight, so
                            the row still announces itself once the eye has
                            left the accent marker on the left edge. */}
                        <span
                          className={`block truncate text-[13px] leading-tight text-ink ${
                            active ? 'font-medium' : ''
                          }`}
                        >
                          <Highlight text={rowTitle(item)} query={query} />
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11.5px] leading-tight text-ink-3">
                          <span className="min-w-0 truncate">{subtitleOf(item)}</span>
                          {item.project && (
                            <>
                              <span className="shrink-0 text-line-strong">/</span>
                              <span className="shrink-0 truncate text-ink-3">{item.project}</span>
                            </>
                          )}
                        </span>
                      </span>

                      <span className="grid w-4 shrink-0 place-items-center" aria-hidden>
                        {score ? (
                          <span
                            className={`block h-1.5 w-1.5 rounded-full ring-4 ${VERDICT_DOT[score.verdict]}`}
                            title={`Password strength: ${score.verdict}`}
                          />
                        ) : item.kind === 'login' ? (
                          <WarningCircle size={14} weight="bold" className="text-ink-3" />
                        ) : item.kind === 'asset' && !item.asset?.received ? (
                          <span
                            className="block h-1.5 w-1.5 rounded-full bg-fair ring-4 ring-fair/25"
                            title="Not yet received by the owner"
                          />
                        ) : null}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The bold line. An asset's title is just "make model" now, which makes two
 * of the same laptop read as identical rows — the category is what actually
 * distinguishes what you're looking at, so that leads instead.
 */
function rowTitle(item: VaultItem): string {
  if (item.kind !== 'asset') return item.title;
  const category = item.asset?.category;
  return category ? (ASSET_CATEGORY_LABEL[category] ?? category) : item.title;
}

/** The one line under the title that says most about this kind of entry. */
function subtitleOf(item: VaultItem): string {
  switch (item.kind) {
    case 'env':
      return `${item.vars.length} ${item.vars.length === 1 ? 'variable' : 'variables'}`;
    case 'billing': {
      const b = item.billing;
      if (!b) return item.entity;
      const money =
        b.amount != null ? `${b.currency} ${b.amount.toLocaleString()}` : 'No amount';
      return b.vendor ? `${b.vendor} · ${money}` : money;
    }
    case 'asset':
      // The category is the bold line for an asset (see rowTitle below), so
      // this carries the specific device and who has it instead.
      return [item.title, item.owner?.name ?? 'Unallocated'].filter(Boolean).join(' · ');
    default:
      return item.username ?? item.accountType ?? item.entity;
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().split(/\s+/)[0]?.toLowerCase();
  if (!needle) return <>{text}</>;

  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-accent/20 text-accent">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
