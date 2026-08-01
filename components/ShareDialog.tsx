'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Copy, LinkSimple, ShieldCheck, X } from '@phosphor-icons/react/dist/ssr';
import { useVault } from './vault-context.tsx';

/** What a share link carries once decrypted. */
export type SharePayload = {
  title: string;
  /** Rendered as label and value pairs on the claim page. */
  entries: { label: string; value: string; secret: boolean }[];
  note?: string | null;
};

const EXPIRY_CHOICES = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
];

const VIEW_CHOICES = [
  { views: 1, label: 'Once' },
  { views: 3, label: '3 times' },
  { views: 10, label: '10 times' },
];

export function ShareDialog({ payload, onClose }: { payload: SharePayload; onClose: () => void }) {
  const { createShare, copy } = useVault();
  const reduce = useReducedMotion();

  const [recipient, setRecipient] = useState('');
  const [hours, setHours] = useState(24);
  const [maxViews, setMaxViews] = useState(1);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipientOk = recipient.trim().length >= 2;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const url = await createShare(payload, {
        label: payload.title,
        recipientName: recipient.trim(),
        hours,
        maxViews,
      });
      setLink(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  }

  const secretCount = payload.entries.filter((entry) => entry.secret).length;

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
        aria-label="Share securely"
        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        className="relative w-full max-w-[520px] overflow-hidden rounded-[12px] border border-line-strong bg-panel shadow-[var(--shadow-dialog)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            <LinkSimple size={15} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold tracking-tight text-ink">
              Share {payload.title}
            </p>
            <p className="text-[11.5px] text-ink-3">
              {payload.entries.length} values, {secretCount} secret
            </p>
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

        <div className="px-5 py-5">
          {link ? (
            <>
              <p className="label-caps">Send this link</p>
              <div className="mt-2 flex items-start gap-2 rounded-[8px] border border-line bg-bg p-3">
                <code className="min-w-0 flex-1 break-all font-secret text-[12px] leading-relaxed text-ink">
                  {link}
                </code>
                <button
                  type="button"
                  onClick={() => copy(link, 'Share link')}
                  aria-label="Copy share link"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink active:scale-95"
                >
                  <Copy size={14} weight="bold" />
                </button>
              </div>

              <ul className="mt-4 space-y-2">
                <Point>
                  The decryption key sits after the <span className="font-mono">#</span>, which
                  browsers never send to a server. Copy the whole link or it will not open.
                </Point>
                <Point>
                  Only opens for someone typing <span className="text-ink-2">{recipient.trim()}</span>.
                  Any other name derives the wrong key and the payload stays sealed.
                </Point>
                <Point>
                  Opens {maxViews === 1 ? 'once' : `${maxViews} times`}, then deletes itself. Expires
                  in {EXPIRY_CHOICES.find((c) => c.hours === hours)?.label}.
                </Point>
              </ul>

              <button
                type="button"
                onClick={onClose}
                className="mt-5 w-full rounded-[8px] border border-line px-4 py-2.5 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
              >
                Done
              </button>
            </>
          ) : (
            <>
              {/* The name is folded into the encryption key, so this is not a
                  UI check: without it the ciphertext will not open. */}
              <div className="mb-4">
                <label htmlFor="recipient" className="label-caps mb-2 block">
                  Who is it for
                </label>
                <input
                  id="recipient"
                  autoFocus
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Ammar Shaikh"
                  autoComplete="off"
                  className="w-full rounded-[8px] border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60"
                />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
                  They will have to type this name to open the link. Tell them which form you used.
                </p>
              </div>

              <Choice
                label="Expires after"
                options={EXPIRY_CHOICES.map((c) => ({ key: c.hours, label: c.label }))}
                value={hours}
                onChange={setHours}
              />
              <Choice
                label="Can be opened"
                options={VIEW_CHOICES.map((c) => ({ key: c.views, label: c.label }))}
                value={maxViews}
                onChange={setMaxViews}
              />

              <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
                <ShieldCheck size={14} weight="bold" className="mt-px shrink-0 text-strong" />
                Encrypted with a one-off key derived from the link and that name, not your master
                password. A link on its own opens nothing, and neither does the rest of the vault.
              </p>

              {error && <p className="mt-3 text-[12.5px] text-weak">{error}</p>}

              <button
                type="button"
                onClick={generate}
                disabled={busy || !recipientOk}
                className="mt-5 w-full rounded-[8px] bg-accent px-4 py-2.5 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:opacity-40"
              >
                {busy ? 'Creating link' : 'Create link'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Choice<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mb-4">
      <p className="label-caps mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={value === option.key}
            className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] transition ${
              value === option.key
                ? 'border-accent/40 bg-accent/12 text-accent'
                : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
      <Check size={13} weight="bold" className="mt-0.5 shrink-0 text-strong" />
      <span>{children}</span>
    </li>
  );
}

export function ShareDialogHost({
  payload,
  onClose,
}: {
  payload: SharePayload | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {payload && <ShareDialog key="share" payload={payload} onClose={onClose} />}
    </AnimatePresence>
  );
}
