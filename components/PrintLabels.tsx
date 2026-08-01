'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Barcode, Printer, X } from '@phosphor-icons/react/dist/ssr';
import { assetQrPayload } from '@/lib/qr.ts';
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

  const sheet = useMemo(() => {
    const chosen = assets.filter((asset) => selected.has(asset.id));
    return chosen.flatMap((asset) =>
      Array.from({ length: copies }, (_, copy) => ({
        key: `${asset.id}-${copy}`,
        tag: asset.asset!.tag!,
        title: asset.title,
        serial: asset.asset!.serial,
        assignee: asset.owner?.name ?? null,
        qr: assetQrPayload(asset),
      })),
    );
  }, [assets, selected, copies]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg print:static print:bg-white">
      {/* Controls. Hidden when printing. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 print:hidden">
        <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
          <Barcode size={15} weight="bold" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-tight text-ink">Asset labels</p>
          <p className="text-[11.5px] text-ink-3">
            {sheet.length} {sheet.length === 1 ? 'label' : 'labels'} at 50 by 25mm
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
            <div className="border-b border-line p-4 print:hidden">
              <div className="flex flex-wrap gap-1.5">
                {assets.map((asset) => {
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
                })}
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
