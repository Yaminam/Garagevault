'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Barcode, Printer, X } from '@phosphor-icons/react/dist/ssr';
import { ASSET_CATEGORY_LABEL } from '@/lib/assets.ts';
import { assetQrUrl, currentOrigin } from '@/lib/qr.ts';
import type { VaultItem } from '@/lib/types.ts';
import { AssetLabel } from './BarcodeLabel.tsx';

/**
 * Label sheet.
 *
 * Rendered inside the unlocked tab rather than a print route, because the vault
 * is only decrypted here: a second tab would have no key and print blanks.
 * The `print-sheet` class is what the print stylesheet keeps; everything else on
 * the page is hidden at print time.
 */
export function PrintLabels({ items, onClose }: { items: VaultItem[]; onClose: () => void }) {
  const reduce = useReducedMotion();

  const assets = useMemo(
    () => items.filter((item) => item.kind === 'asset' && item.asset?.tag),
    [items],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(assets.map((a) => a.id)));
  const [copies, setCopies] = useState(1);

  // Narrows which tags are offered below, not what's already picked to print
  // — switching the filter should never silently drop something you already
  // chose. Both rows show at once rather than behind a tab, so filtering by
  // category and by person can be combined.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(assets.map((a) => a.asset?.category).filter((c): c is string => !!c))].sort(),
    [assets],
  );
  const employees = useMemo(
    () => [...new Set(assets.map((a) => a.owner?.name).filter((n): n is string => !!n))].sort(),
    [assets],
  );
  const visible = useMemo(
    () =>
      assets.filter(
        (a) =>
          (!categoryFilter || a.asset?.category === categoryFilter) &&
          (!employeeFilter || a.owner?.name === employeeFilter),
      ),
    [assets, categoryFilter, employeeFilter],
  );

  const sheet = useMemo(() => {
    // Everything starts selected, so a filter with no effect here would look
    // broken: it would narrow the pills on offer while the sheet underneath
    // kept printing all of them regardless. Intersecting with the filtered
    // list makes the filter actually control what's shown and printed, and
    // individual pills still narrow further within that.
    const chosen = visible.filter((asset) => selected.has(asset.id));
    return chosen.flatMap((asset) =>
      Array.from({ length: copies }, (_, copy) => ({
        key: `${asset.id}-${copy}`,
        tag: asset.asset!.tag!,
        title: asset.title,
        category: asset.asset!.category
          ? (ASSET_CATEGORY_LABEL[asset.asset!.category] ?? asset.asset!.category)
          : null,
        serial: asset.asset!.serial,
        assignee: asset.owner?.name ?? null,
        department: asset.owner?.department ?? null,
        qr: assetQrUrl(asset, currentOrigin()),
      })),
    );
  }, [visible, selected, copies]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg print:bg-white">
      {/* Controls. Hidden when printing. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 print:hidden">
        <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
          <Barcode size={15} weight="bold" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-tight text-ink">Asset labels</p>
          <p className="text-[11.5px] text-ink-3">
            {sheet.length} {sheet.length === 1 ? 'label' : 'labels'} at 70 by 35mm
          </p>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          Copies
          <input
            type="number"
            min={1}
            max={10}
            value={copies}
            onChange={(e) => setCopies(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            className="w-14 rounded-[8px] border border-line bg-bg px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent/60"
          />
        </label>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={sheet.length === 0}
          className="flex items-center gap-1.5 rounded-[8px] bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:opacity-35"
        >
          <Printer size={14} weight="bold" />
          Print
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X size={15} weight="bold" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        {assets.length === 0 ? (
          <p className="p-10 text-center text-[13px] text-ink-3 print:hidden">
            No assets with a tag yet. Add one and a tag is generated automatically.
          </p>
        ) : (
          <>
            {/* Picker */}
            <div className="space-y-2.5 border-b border-line p-4 print:hidden">
              {categories.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[11px] text-ink-3">Category</span>
                  <FilterChip
                    label="All"
                    active={!categoryFilter}
                    onClick={() => setCategoryFilter(null)}
                  />
                  {categories.map((c) => (
                    <FilterChip
                      key={c}
                      label={ASSET_CATEGORY_LABEL[c] ?? c}
                      active={categoryFilter === c}
                      onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                    />
                  ))}
                </div>
              )}

              {employees.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[11px] text-ink-3">Person</span>
                  <FilterChip
                    label="All"
                    active={!employeeFilter}
                    onClick={() => setEmployeeFilter(null)}
                  />
                  {employees.map((e) => (
                    <FilterChip
                      key={e}
                      label={e}
                      active={employeeFilter === e}
                      onClick={() => setEmployeeFilter(employeeFilter === e ? null : e)}
                    />
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {visible.length === 0 ? (
                  <p className="text-[12px] text-ink-3">Nothing matches that filter.</p>
                ) : (
                  visible.map((asset) => {
                    const on = selected.has(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggle(asset.id)}
                        aria-pressed={on}
                        className={`rounded-full border px-3 py-1.5 font-mono text-[11.5px] transition ${
                          on
                            ? 'border-accent/40 bg-accent/12 text-accent'
                            : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
                        }`}
                      >
                        {asset.asset!.tag}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* The sheet itself */}
            <div className="print-sheet flex flex-wrap gap-[3mm] p-[5mm]">
              {sheet.map((label) => (
                <AssetLabel key={label.key} data={label} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
        active
          ? 'border-accent/40 bg-accent/12 text-accent'
          : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
      }`}
    >
      {label}
    </button>
  );
}

export function PrintLabelsHost({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: VaultItem[];
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="print"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <PrintLabels items={items} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
