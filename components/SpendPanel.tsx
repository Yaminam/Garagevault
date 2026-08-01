'use client';

/**
 * The spend page.
 *
 * Four views of the same money, each answering a different question, which is
 * the only reason to draw four charts instead of one:
 *
 *   per month    how much, and is it steady          vertical bars
 *   cumulative   what has this year cost so far      area
 *   by vendor    who is taking it                    ranked bars
 *   by project   what it is being spent on           ranked bars
 *
 * Every chart is a single series, so none of them needs a legend and none of
 * them needs a categorical palette: one hue, `--chart-1`, checked against the
 * surface it sits on in each theme. Colour is doing no work here beyond "this
 * is data", and the ranked charts carry direct labels because they have the
 * room, so identity never rests on colour at all.
 *
 * Hovering a month lights it in both time-series charts at once, because they
 * are two readings of the same axis and pairing them is what makes the second
 * chart worth having.
 */

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Receipt } from '@phosphor-icons/react/dist/ssr';
import { analyseSpend, formatMoney, spendCurrencies, type SpendSlice } from '@/lib/spend.ts';
import { useVault } from './vault-context.tsx';
import { EmptyState } from './primitives.tsx';

/** How many rows a ranked chart shows before folding the rest into "Other". */
const RANK_LIMIT = 6;

export function SpendPanel() {
  const { items } = useVault();
  const [hovered, setHovered] = useState<string | null>(null);

  // Null means "whichever has the most bills", so the page opens on the busiest
  // currency without that choice being frozen in on the first render.
  const [picked, setPicked] = useState<string | null>(null);
  const currencies = useMemo(() => spendCurrencies(items), [items]);
  const spend = useMemo(() => analyseSpend(items, 12, picked), [items, picked]);

  if (spend.total === 0) {
    return (
      <EmptyState
        icon={<Receipt size={21} weight="duotone" />}
        title="No spend recorded yet"
        hint="Upload invoices from the rail and this fills in: what you spend a month, where it goes, and what renews next."
      />
    );
  }

  const active = hovered ? spend.months.find((m) => m.key === hovered) ?? null : null;
  const activeIndex = hovered ? spend.months.findIndex((m) => m.key === hovered) : -1;

  // Currencies are switched between rather than warned about, so the only
  // thing left to admit to is the bills that were genuinely dropped.
  const caveat =
    spend.outliers > 0
      ? `${spend.outliers} one-off ${spend.outliers === 1 ? 'bill' : 'bills'} excluded, an order of magnitude above the rest`
      : null;

  return (
    <div className="h-full overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto max-w-[1100px]">
        {currencies.length > 1 && (
          <div className="mb-3 flex items-center gap-1 rounded-full border border-line bg-raised/60 p-0.5 w-fit">
            {currencies.map((code) => {
              const on = code === spend.currency;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setPicked(code)}
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1 font-mono text-[11.5px] transition-colors ${
                    on ? 'bg-accent text-accent-ink' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>
        )}
        {/* Headline figures. Not charts, because a single number does not need
            a plot to be read, and the tiles anchor the scale for everything
            underneath. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line lg:grid-cols-4">
          <Stat
            label={`Last 12 months`}
            value={formatMoney(spend.total, spend.currency)}
            note={`${spend.currency}`}
          />
          <Stat
            label="Average a month"
            value={formatMoney(spend.perMonth, spend.currency)}
            note="across the window"
          />
          <Stat
            label="Committed run rate"
            value={formatMoney(spend.runRate, spend.currency)}
            note={`${spend.subscriptions} recurring`}
          />
          <Stat
            label="Next renewal"
            value={
              spend.nextRenewal
                ? new Date(spend.nextRenewal.on).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })
                : 'None due'
            }
            note={spend.nextRenewal?.name ?? 'nothing scheduled'}
          />
        </div>

        {caveat && <p className="mt-2.5 text-[11.5px] leading-snug text-ink-3">{caveat}</p>}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card
            title="Spend by month"
            readout={
              active
                ? `${active.label} · ${formatMoney(active.total, spend.currency)}`
                : 'hover a bar'
            }
          >
            <MonthBars
              months={spend.months}
              peak={spend.peak}
              currency={spend.currency}
              hovered={hovered}
              onHover={setHovered}
            />
          </Card>

          <Card
            title="Running total"
            readout={
              activeIndex >= 0
                ? `to ${spend.months[activeIndex].short} · ${formatMoney(spend.cumulative[activeIndex], spend.currency)}`
                : formatMoney(spend.total, spend.currency)
            }
          >
            <Cumulative
              values={spend.cumulative}
              months={spend.months.map((m) => m.key)}
              hovered={hovered}
              onHover={setHovered}
            />
          </Card>

          <Card title="Where it goes" readout={`top ${Math.min(RANK_LIMIT, spend.byVendor.length)}`}>
            <Ranked rows={spend.byVendor} currency={spend.currency} empty="No vendors named yet." />
          </Card>

          <Card
            title="By project"
            readout={`top ${Math.min(RANK_LIMIT, spend.byProject.length)}`}
          >
            <Ranked
              rows={spend.byProject}
              currency={spend.currency}
              empty="No bills are filed under a project yet."
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- pieces ---- */

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-panel px-4 py-3.5">
      <p className="label-caps">{label}</p>
      <p className="mt-1.5 font-mono text-[19px] font-medium leading-none tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1.5 truncate text-[11.5px] text-ink-3">{note}</p>
    </div>
  );
}

function Card({
  title,
  readout,
  children,
}: {
  title: string;
  readout: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {/* The live readout sits where a legend would, and does more. */}
        <span className="truncate font-mono text-[11px] tabular-nums text-ink-3">{readout}</span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MonthBars({
  months,
  peak,
  currency,
  hovered,
  onHover,
}: {
  months: { key: string; short: string; label: string; total: number }[];
  peak: number;
  currency: string;
  hovered: string | null;
  onHover: (key: string | null) => void;
}) {
  const reduce = useReducedMotion();

  return (
    <div onMouseLeave={() => onHover(null)}>
      {/* `items-end` anchors every bar to the baseline, which is the only
          honest way to read magnitude. */}
      <div className="flex h-[150px] items-end gap-[3px]">
        {months.map((month, index) => {
          const ratio = peak > 0 ? month.total / peak : 0;
          const dim = hovered !== null && hovered !== month.key;

          return (
            <span
              key={month.key}
              onMouseEnter={() => onHover(month.key)}
              title={`${month.label}: ${formatMoney(month.total, currency)}`}
              className="flex h-full flex-1 cursor-default items-end"
            >
              {month.total === 0 ? (
                // A month with no spend is a real zero and has to be visible as
                // one, or the eye reads the gap as missing data.
                <span className="block h-[2px] w-full rounded-full bg-line-strong" />
              ) : (
                <motion.span
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: `${Math.max(ratio * 100, 3)}%` }}
                  transition={{
                    duration: 0.55,
                    delay: reduce ? 0 : index * 0.035,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={{ background: 'var(--chart-1)' }}
                  className={`block w-full rounded-t-[4px] transition-opacity ${
                    dim ? 'opacity-30' : 'opacity-100'
                  }`}
                />
              )}
            </span>
          );
        })}
      </div>

      <div className="mt-2 flex gap-[3px]">
        {months.map((month) => (
          <span
            key={month.key}
            className={`flex-1 text-center font-mono text-[9.5px] transition-colors ${
              hovered === month.key ? 'text-ink' : 'text-ink-3'
            }`}
          >
            {month.short.slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Cumulative({
  values,
  months,
  hovered,
  onHover,
}: {
  values: number[];
  months: string[];
  hovered: string | null;
  onHover: (key: string | null) => void;
}) {
  const reduce = useReducedMotion();
  const top = values[values.length - 1] || 1;
  const last = values.length - 1;

  // Plotted in a unit box and stretched by CSS. `non-scaling-stroke` keeps the
  // line 2px however far the box is stretched, which is the whole trick.
  const point = (index: number): [number, number] => [
    last === 0 ? 0 : (index / last) * 100,
    40 - (values[index] / top) * 38,
  ];

  const line = values.map((_, i) => point(i).join(',')).join(' ');
  const area = `0,40 ${line} 100,40`;
  const activeIndex = hovered ? months.indexOf(hovered) : -1;

  return (
    <div className="relative" onMouseLeave={() => onHover(null)}>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-[150px] w-full"
        role="img"
        aria-label="Running total of spend across the window."
      >
        <defs>
          <linearGradient id="spend-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <motion.polygon
          points={area}
          fill="url(#spend-fade)"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        <motion.polyline
          points={line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
        {activeIndex >= 0 && (
          <line
            x1={point(activeIndex)[0]}
            y1={0}
            x2={point(activeIndex)[0]}
            y2={40}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Hit targets sit above the plot rather than on the marks, so the
          thin line does not have to be aimed at. */}
      <div className="absolute inset-0 flex">
        {months.map((key) => (
          <span key={key} onMouseEnter={() => onHover(key)} className="h-full flex-1" />
        ))}
      </div>
    </div>
  );
}

function Ranked({
  rows,
  currency,
  empty,
}: {
  rows: SpendSlice[];
  currency: string;
  empty: string;
}) {
  const reduce = useReducedMotion();

  if (rows.length === 0) {
    return <p className="py-6 text-center text-[12px] text-ink-3">{empty}</p>;
  }

  // Everything past the cut folds into one row rather than being dropped, so
  // the bars still add up to the total the tiles report.
  const head = rows.slice(0, RANK_LIMIT);
  const tail = rows.slice(RANK_LIMIT);
  const shown = tail.length
    ? [
        ...head,
        {
          name: `${tail.length} more`,
          total: tail.reduce((sum, row) => sum + row.total, 0),
          count: tail.reduce((sum, row) => sum + row.count, 0),
          also: [],
        },
      ]
    : head;

  const top = shown[0]?.total || 1;

  return (
    <ul className="space-y-2.5">
      {shown.map((row, index) => (
        <li key={row.name}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px] text-ink-2">{row.name}</span>
            <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink">
              {formatMoney(row.total, currency)}
            </span>
          </div>

          {/* A vendor billing in more than one currency says so, side by side.
              Not converted, and not added to the bar: the bar measures this
              currency, and a rate the data does not contain would be made up. */}
          {row.also.length > 0 && (
            <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3">
              also{' '}
              {row.also.map((other, index) => (
                <span key={other.currency}>
                  {index > 0 && ', '}
                  <span className="font-mono">{formatMoney(other.total, other.currency)}</span>
                </span>
              ))}
            </p>
          )}
          <div className="mt-1.5 h-[6px] w-full">
            <motion.span
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${Math.max((row.total / top) * 100, 2)}%` }}
              transition={{
                duration: 0.55,
                delay: reduce ? 0 : index * 0.05,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{ background: 'var(--chart-1)' }}
              className="block h-full rounded-full"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
