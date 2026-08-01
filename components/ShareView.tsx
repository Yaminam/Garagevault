'use client';

/**
 * The recipient's page.
 *
 * No access to the vault. It holds exactly one payload, decrypted with a key
 * derived from the URL fragment and the recipient's name, so whoever opens a
 * link sees only what was shared with them, and only if they are the intended
 * person.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Copy,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
  WarningOctagon,
} from '@phosphor-icons/react/dist/ssr';
import {
  ShareGoneError,
  WrongRecipientError,
  claimShare,
  peekShare,
  type SharePeek,
} from '@/lib/shares.ts';
import { getBrowserClient } from '@/lib/supabase.ts';
import type { SharePayload } from './ShareDialog.tsx';
import { ToastProvider, useToast } from './primitives.tsx';

export function ShareView({ id }: { id: string }) {
  return (
    <ToastProvider>
      <ShareViewInner id={id} />
    </ToastProvider>
  );
}

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; peek: SharePeek; error: string | null; busy: boolean }
  | { kind: 'open'; payload: SharePayload; viewsLeft: number }
  | { kind: 'gone'; message: string };

function ShareViewInner({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const reduce = useReducedMotion();
  const toast = useToast();

  // The fragment never reaches the server, so it can only be read here.
  useEffect(() => {
    setToken(window.location.hash.replace(/^#/, '') || null);
  }, []);

  // Peeking is deliberately separate from claiming: showing which name to type
  // must not spend one of the recipient's views.
  useEffect(() => {
    let cancelled = false;
    peekShare(getBrowserClient(), id)
      .then((peek) => {
        if (!cancelled) setState({ kind: 'ask', peek, error: null, busy: false });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          kind: 'gone',
          message:
            error instanceof ShareGoneError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'This link could not be opened.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const reveal = useCallback(async () => {
    if (!token || state.kind !== 'ask') return;
    setState({ ...state, busy: true, error: null });

    try {
      const claimed = await claimShare<SharePayload>(getBrowserClient(), id, token, name);
      setState({ kind: 'open', payload: claimed.payload, viewsLeft: claimed.viewsLeft });
    } catch (error) {
      if (error instanceof WrongRecipientError) {
        // The view is already spent, so say so rather than inviting a retry
        // that may not be there.
        setState({ ...state, busy: false, error: error.message });
      } else {
        setState({
          kind: 'gone',
          message: error instanceof Error ? error.message : 'This link could not be opened.',
        });
      }
    }
  }, [id, token, name, state]);

  const copy = (value: string, label: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => toast.push(`${label} copied`))
      .catch(() => toast.push('Could not reach the clipboard', 'warn'));
  };

  return (
    <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-6 py-16">
      <div className="ambient pointer-events-none absolute inset-0" aria-hidden />
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="lift relative w-full max-w-[540px] overflow-hidden rounded-[12px] border border-line bg-panel"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          {/* White monochrome lockup, the standard treatment on dark. */}
          <img
            src="/logo-dark.png"
            alt="Garage Collective"
            width={28}
            height={28}
            className="shrink-0 [filter:brightness(0)_invert(1)]"
          />
          <span className="h-5 w-px bg-line-strong" aria-hidden />
          <span className="font-mono text-[12px] text-ink-3">shared secret</span>
        </div>

        <div className="px-6 py-7">
          {state.kind === 'loading' && (
            <p className="label-caps animate-pulse py-8 text-center">Checking the link</p>
          )}

          {state.kind === 'gone' && (
            <>
              <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-weak/30 bg-weak/10 text-weak">
                <WarningOctagon size={19} weight="bold" />
              </span>
              <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">
                Nothing here anymore
              </h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{state.message}</p>
              <p className="mt-4 text-[12.5px] text-ink-3">
                Ask whoever sent it to create a new link.
              </p>
            </>
          )}

          {state.kind === 'ask' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (token && name.trim() && !state.busy) reveal();
              }}
            >
              <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-accent/35 bg-accent/12 text-accent">
                <LockKey size={19} weight="bold" />
              </span>
              <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">
                {state.peek.label ? `Someone shared ${state.peek.label}` : 'Someone shared a secret'}
              </h1>

              {!token ? (
                <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                  This link is missing its decryption key. Copy the full link from the original
                  message, including everything after the # symbol.
                </p>
              ) : (
                <>
                  <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                    It was locked to one person. Type their name to open it.
                  </p>

                  <label htmlFor="recipient-name" className="label-caps mb-2 mt-6 block">
                    Your name
                  </label>
                  <input
                    id="recipient-name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={state.busy}
                    autoComplete="off"
                    placeholder={state.peek.recipientHint ?? 'As the sender wrote it'}
                    className="w-full rounded-[8px] border border-line bg-bg px-3 py-3 text-[14px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60 disabled:opacity-60"
                  />
                  {state.error ? (
                    <p role="alert" className="mt-2 text-[12.5px] text-weak">
                      {state.error}
                    </p>
                  ) : (
                    <p className="mt-2 text-[12.5px] text-ink-3">
                      {state.peek.recipientHint
                        ? `Expecting ${state.peek.recipientHint}. Capitals and spacing do not matter.`
                        : 'Capitals and spacing do not matter.'}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={!name.trim() || state.busy}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent px-4 py-3 text-[13.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {state.busy ? (
                      <>
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-accent-ink/30 border-t-accent-ink" />
                        Opening
                      </>
                    ) : (
                      'Unlock secret'
                    )}
                  </button>

                  <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">
                    Opening spends one of {state.peek.viewsLeft} remaining{' '}
                    {state.peek.viewsLeft === 1 ? 'view' : 'views'}. Have somewhere ready to put it.
                  </p>
                </>
              )}
            </form>
          )}

          {state.kind === 'open' && (
            <>
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">
                {state.payload.title}
              </h1>
              <p className="mt-1.5 text-[12.5px] text-ink-3">
                {state.viewsLeft > 0
                  ? `Can be opened ${state.viewsLeft} more ${state.viewsLeft === 1 ? 'time' : 'times'}.`
                  : 'This link has now been destroyed. Copy what you need before leaving.'}
              </p>

              <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
                {state.payload.entries.map((entry) => (
                  <Row
                    key={entry.label}
                    label={entry.label}
                    value={entry.value}
                    secret={entry.secret}
                    onCopy={() => copy(entry.value, entry.label)}
                  />
                ))}
              </div>

              {state.payload.note && (
                <p className="mt-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
                  {state.payload.note}
                </p>
              )}

              <p className="mt-5 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
                <ShieldCheck size={14} weight="bold" className="mt-px shrink-0 text-strong" />
                Decrypted in your browser from the link and your name. Neither was sent to any
                server.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </main>
  );
}

function Row({
  label,
  value,
  secret,
  onCopy,
}: {
  label: string;
  value: string;
  secret: boolean;
  onCopy: () => void;
}) {
  const [revealed, setRevealed] = useState(!secret);

  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span className="w-[38%] shrink-0 truncate font-mono text-[11.5px] text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 truncate font-secret text-[13px] text-ink">
        {revealed ? value : '•'.repeat(Math.min(value.length, 22))}
      </span>
      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink"
        >
          {revealed ? <EyeSlash size={13} weight="bold" /> : <Eye size={13} weight="bold" />}
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink active:scale-95"
      >
        <Copy size={14} weight="bold" />
      </button>
    </div>
  );
}
