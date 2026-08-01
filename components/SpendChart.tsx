'use client';

/**
 * Monthly spend, in the rail.
 *
 * A 236px column is not enough room for axes, gridlines and a legend, and a
 * single series does not need a legend anyway. So the chart carries exactly
 * three things: a headline number, nine bars, and a caption. Hovering a bar
 * swaps the headline to that month rather than opening a tooltip, which keeps
 * the readout inside the rail instead of overflowing it, and means the number
 * you are reading is always in the same place.
 *
 * Colour comes from `--chart-1`, a step chosen per theme and checked against
 * the surface it sits on rather than reused from the UI accent.
 */

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { formatMoney, monthlySpend } from '@/lib/spend.ts';
import type { VaultItem } from '@/lib/types.ts';

export function SpendChart({ items, onOpen }: { items: VaultItem[]; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);

  const spend = useMemo(() => monthlySpend(items), [items]);
  const active = hovered ? spend.months.find((m) => m.key === hovered) : null;

  if (spend.months.length === 0 || spend.total === 0) {
    return (
      <div className="rounded-[9px] border border-dashed border-line px-3 py-4 text-center">
        <p className="text-[11.5px] leading-snug text-ink-3">
          Upload an invoice and monthly spend appears here.
        </p>
      </div>
    );
  }

  const from = spend.months[0];
  const to = spend.months[spend.months.length - 1];

  // What the caption has to admit to. Both are omissions the reader would
  // otherwise have no way to notice.
  const caveats = [
    spend.outliers > 0 ? `${spend.outliers} one-off excluded` : null,
    spend.otherCurrency > 0 ? `${spend.otherCurrency} in another currency` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseLeave={() => setHovered(null)}
      className="sheen w-full rounded-[9px] border border-line bg-raised/60 p-3 text-left transition hover:border-line-strong"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps">{active ? active.label : 'Monthly spend'}</span>
        <span className="font-mono text-[13px] font-medium tabular-nums text-ink">
          {formatMoney(active ? active.total : spend.total, spend.currency)}
        </span>
      </div>

      {/*
        Bars are flex children rather than an SVG so they reflow with the rail
        and each one is its own hit target. `items-end` anchors every bar to the
        baseline, which is the only honest way to read magnitude.
      */}
      <div
        className="mt-2.5 flex h-[46px] items-end gap-[2px]"
        role="img"
        aria-label={`Spend over the last ${spend.months.length} months, ${formatMoney(spend.total, spend.currency)} in total.`}
      >
        {spend.months.map((month, index) => {
          const ratio = spend.peak > 0 ? month.total / spend.peak : 0;
          const dim = hovered !== null && hovered !== month.key;

          return (
            <span
              key={month.key}
              onMouseEnter={() => setHovered(month.key)}
              title={`${month.label}: ${formatMoney(month.total, spend.currency)}`}
              className="flex h-full flex-1 items-end"
            >
              {month.total === 0 ? (
                // A month with no spend is a real zero and has to be visible as
                // one, otherwise the eye reads a gap as missing data.
                <span className="block h-[2px] w-full rounded-full bg-line-strong" />
              ) : (
                <motion.span
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: `${Math.max(ratio * 100, 6)}%` }}
                  transition={{
                    duration: 0.5,
                    delay: reduce ? 0 : index * 0.03,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={{ background: 'var(--chart-1)' }}
                  className={`block w-full rounded-t-[4px] transition-opacity ${
                    dim ? 'opacity-35' : 'opacity-100'
                  }`}
                />
              )}
            </span>
          );
        })}
      </div>

      <p className="mt-2 flex items-center justify-between gap-2 text-[10.5px] leading-snug text-ink-3">
        <span className="truncate">
          {from.label.split(' ')[0].slice(0, 3)} to {to.label.split(' ')[0].slice(0, 3)}
        </span>
        <span className="shrink-0 font-mono">{spend.currency}</span>
      </p>

      {caveats.length > 0 && (
        <p className="mt-1 text-[10.5px] leading-snug text-ink-3">{caveats.join(', ')}</p>
      )}
    </button>
  );
}
