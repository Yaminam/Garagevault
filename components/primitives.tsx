'use client';

/**
 * Shared UI primitives.
 *
 * Icon convention for the whole app: Phosphor, `weight="bold"` at 14 to 18px for
 * controls, `weight="duotone"` for large decorative marks only.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle, Warning } from '@phosphor-icons/react/dist/ssr';
import type { Verdict } from '@/lib/audit.ts';
import type { BrandMark } from '@/lib/brand-marks.ts';

/* --------------------------------------------------------------- tile ---- */

export type TileSize = 'sm' | 'md' | 'lg';

const TILE_SIZE: Record<TileSize, string> = {
  sm: 'h-7 w-7 text-[10px] rounded-[6px]',
  md: 'h-9 w-9 text-[11px] rounded-[8px]',
  lg: 'h-14 w-14 text-base rounded-[12px]',
};

const GLYPH_SIZE: Record<TileSize, number> = { sm: 13, md: 16, lg: 26 };

/**
 * The square that leads every entry, whatever is inside it. Shared so a brand
 * mark, a monogram and a kind icon all sit on exactly the same footprint and
 * the left edge of the list stays a straight line.
 */
export function tileClass(size: TileSize, active: boolean): string {
  return `${TILE_SIZE[size]} grid shrink-0 place-items-center border transition-colors ${
    active ? 'border-accent/40 bg-accent/12 text-accent' : 'border-line bg-raised text-ink-3'
  }`;
}

/* ------------------------------------------------------------ monogram ---- */

/** Two-letter mark derived from the item title. */
export function Monogram({ label, size = 'md', active = false }: {
  label: string;
  size?: TileSize;
  active?: boolean;
}) {
  const initials = useMemo(() => {
    const cleaned = label.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [label]);

  return (
    <span aria-hidden className={`${tileClass(size, active)} font-mono font-medium tracking-tight`}>
      {initials}
    </span>
  );
}

/* ---------------------------------------------------------- brand mark ---- */

/**
 * A real logo, drawn from bundled path data and filled with `currentColor`.
 * Monochrome on purpose: see the note at the top of `lib/brand-marks.ts`.
 * At rest the mark sits at ink-2 rather than ink-3, because a silhouette needs
 * a little more weight than a letterform to stay legible at 16px.
 */
export function BrandTile({ mark, size = 'md', active = false }: {
  mark: BrandMark;
  size?: TileSize;
  active?: boolean;
}) {
  const glyph = GLYPH_SIZE[size];
  return (
    <span
      title={mark.title}
      className={`${tileClass(size, active)} ${active ? '' : 'text-ink-2'}`}
    >
      <svg
        role="img"
        aria-label={mark.title}
        viewBox="0 0 24 24"
        width={glyph}
        height={glyph}
        fill="currentColor"
      >
        <path d={mark.path} />
      </svg>
    </span>
  );
}

/* --------------------------------------------------------------- meter ---- */

const METER_FILL: Record<Verdict, string> = {
  critical: 'bg-weak',
  weak: 'bg-weak',
  fair: 'bg-fair',
  strong: 'bg-strong',
};

/** Four-segment strength meter. Segments, not a continuous bar, so it reads at a glance. */
export function StrengthMeter({ verdict, percent }: { verdict: Verdict; percent: number }) {
  const lit = { critical: 1, weak: 2, fair: 3, strong: 4 }[verdict];
  return (
    <div className="flex items-center gap-1" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-[3px] w-6 rounded-full transition-colors ${i < lit ? METER_FILL[verdict] : 'bg-line-strong'}`}
        />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- pill ---- */

export function Pill({ children, tone = 'neutral' }: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'good';
}) {
  const tones = {
    neutral: 'border-line bg-raised text-ink-2',
    accent: 'border-accent/30 bg-accent/10 text-accent',
    warn: 'border-fair/25 bg-fair/10 text-fair',
    good: 'border-strong/25 bg-strong/10 text-strong',
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-medium ${tones}`}>
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- toast ---- */

type Toast = { id: number; message: string; tone: 'ok' | 'warn' };
type ToastApi = { push: (message: string, tone?: 'ok' | 'warn') => void };

const ToastContext = createContext<ToastApi>({ push: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: 'ok' | 'warn' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 2600);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-line-strong bg-raised/95 px-3.5 py-2 text-[13px] text-ink shadow-[var(--shadow-toast)] backdrop-blur"
            >
              {toast.tone === 'ok' ? (
                <CheckCircle size={15} weight="bold" className="text-strong" />
              ) : (
                <Warning size={15} weight="bold" className="text-fair" />
              )}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------------------------------------------------- icon button ---- */

export function IconButton({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-8 w-8 place-items-center rounded-[8px] border transition-colors active:scale-[0.96]
        ${active
          ? 'border-accent/40 bg-accent/12 text-accent'
          : 'border-transparent text-ink-3 hover:border-line hover:bg-hover hover:text-ink'
        }`}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- states ---- */

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div className="max-w-[280px]">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[12px] border border-line bg-raised text-ink-3">
          {icon}
        </div>
        <p className="text-[15px] font-medium text-ink-2">{title}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{hint}</p>
      </div>
    </div>
  );
}

/** Skeleton rows matching the item-list shape, shown while the payload loads. */
export function ListSkeleton() {
  return (
    <div className="space-y-1 p-2" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[8px] px-2 py-2.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-[8px] bg-raised" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 animate-pulse rounded bg-raised" style={{ width: `${52 + ((i * 13) % 34)}%` }} />
            <div className="h-2.5 animate-pulse rounded bg-raised/60" style={{ width: `${34 + ((i * 17) % 28)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
