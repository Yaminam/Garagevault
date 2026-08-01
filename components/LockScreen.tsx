'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, LockKey, ShieldCheck, Eye, EyeSlash } from '@phosphor-icons/react/dist/ssr';
import { scorePassword, VERDICT_LABEL } from '@/lib/audit.ts';
import { StrengthMeter } from './primitives.tsx';

type Props = {
  /** `create` runs the first-time setup, `unlock` opens an existing vault. */
  mode: 'create' | 'unlock';
  iterations: number;
  error: string | null;
  busy: boolean;
  onSubmit: (password: string) => void;
};

export function LockScreen({ mode, iterations, error, busy, onSubmit }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  const creating = mode === 'create';
  const score = creating && password ? scorePassword(password) : null;
  const mismatch = creating && confirm.length > 0 && confirm !== password;
  const tooShort = creating && password.length > 0 && password.length < 12;
  const ready = creating ? password.length >= 12 && confirm === password : password.length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error) {
      setPassword('');
      setConfirm('');
      inputRef.current?.focus();
    }
  }, [error]);

  const facts = [
    { label: 'Cipher', value: 'AES-256-GCM' },
    { label: 'Derivation', value: `${Math.round(iterations / 1000)}k PBKDF2` },
    { label: 'Storage', value: 'Ciphertext only' },
  ];

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-6 py-16">
      <div className="ambient pointer-events-none absolute inset-0" aria-hidden />
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-45" aria-hidden />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative grid w-full max-w-[900px] gap-px overflow-hidden rounded-[12px] border border-line bg-line md:grid-cols-[1.05fr_1fr]"
      >
        {/* Identity side */}
        <section className="bg-panel p-8 md:p-10">
          <div className="flex items-center gap-3">
            {/* Monochrome lockup, knocked to white on dark and to black on paper. */}
            <img
              src="/logo-dark.png"
              alt="Garage Collective"
              width={38}
              height={38}
              className="logo-adaptive"
            />
            <span className="h-6 w-px bg-line-strong" aria-hidden />
            <span className="flex items-center gap-1.5 font-mono text-[12.5px] font-medium tracking-tight text-ink-2">
              <LockKey size={13} weight="bold" className="text-accent" />
              vault
            </span>
          </div>

          <h1 className="mt-9 text-[30px] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
            {creating ? (
              <>
                Set the key
                <br />
                that opens it all.
              </>
            ) : (
              <>
                Every credential,
                <br />
                behind one key.
              </>
            )}
          </h1>

          <p className="mt-4 max-w-[40ch] text-[13.5px] leading-relaxed text-ink-2">
            {creating
              ? 'This password derives the encryption key for every entry. Supabase stores the ciphertext and never sees the key.'
              : 'Logins and environment files, encrypted in the browser. The database holds ciphertext it cannot read.'}
          </p>

          <dl className="mt-9 grid grid-cols-3 gap-px overflow-hidden rounded-[8px] border border-line bg-line">
            {facts.map((fact) => (
              <div key={fact.label} className="bg-panel px-3 py-2.5">
                <dt className="label-caps">{fact.label}</dt>
                <dd className="mt-1 font-mono text-[11.5px] text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Form side */}
        <section className="flex flex-col justify-center bg-panel p-8 md:p-10">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !busy) onSubmit(password);
            }}
          >
            <label htmlFor="master" className="label-caps">
              {creating ? 'Choose a master password' : 'Master password'}
            </label>

            <motion.div
              animate={error && !reduce ? { x: [0, -7, 6, -4, 0] } : { x: 0 }}
              transition={{ duration: 0.32 }}
              className="mt-2.5 flex items-center gap-1 rounded-[8px] border border-line bg-bg pr-1 focus-within:border-accent/60"
            >
              <input
                ref={inputRef}
                id="master"
                type={visible ? 'text' : 'password'}
                value={password}
                autoComplete={creating ? 'new-password' : 'current-password'}
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error != null}
                aria-describedby={error ? 'master-error' : 'master-hint'}
                className="w-full bg-transparent px-3 py-3 font-secret text-[14px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
                placeholder={creating ? 'At least 12 characters' : 'Enter to unlock'}
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'Hide password' : 'Show password'}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                {visible ? <EyeSlash size={16} weight="bold" /> : <Eye size={16} weight="bold" />}
              </button>
            </motion.div>

            {creating && score && (
              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[12px] text-ink-2">
                  {VERDICT_LABEL[score.verdict]}
                  <span className="ml-1.5 font-mono text-[11px] text-ink-3">
                    {score.entropyBits} bits
                  </span>
                </span>
                <StrengthMeter verdict={score.verdict} percent={score.percent} />
              </div>
            )}

            {creating && (
              <div className="mt-3">
                <label htmlFor="confirm" className="label-caps">
                  Confirm
                </label>
                <input
                  id="confirm"
                  type={visible ? 'text' : 'password'}
                  value={confirm}
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(event) => setConfirm(event.target.value)}
                  className="mt-2 w-full rounded-[8px] border border-line bg-bg px-3 py-3 font-secret text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/60 disabled:opacity-60"
                  placeholder="Type it again"
                />
              </div>
            )}

            {error ? (
              <p id="master-error" role="alert" className="mt-2.5 text-[12.5px] text-weak">
                {error}
              </p>
            ) : mismatch ? (
              <p className="mt-2.5 text-[12.5px] text-weak">The two entries do not match.</p>
            ) : tooShort ? (
              <p className="mt-2.5 text-[12.5px] text-fair">Use at least 12 characters.</p>
            ) : (
              <p id="master-hint" className="mt-2.5 text-[12.5px] text-ink-3">
                {creating
                  ? 'Write it down somewhere safe before continuing.'
                  : 'The same password used when the vault was created.'}
              </p>
            )}

            <button
              type="submit"
              disabled={!ready || busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent px-4 py-3 text-[13.5px] font-semibold text-accent-ink transition
                hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-accent-ink/30 border-t-accent-ink" />
                  Deriving key
                </>
              ) : (
                <>
                  {creating ? 'Create vault' : 'Unlock vault'}
                  <ArrowRight size={15} weight="bold" />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
            <ShieldCheck size={14} weight="bold" className="mt-px shrink-0 text-strong" />
            No recovery path. If this password is lost, the stored ciphertext cannot be opened by
            anyone, including whoever runs the database.
          </p>
        </section>
      </motion.div>
    </main>
  );
}
