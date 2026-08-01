'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, UserCircle } from '@phosphor-icons/react/dist/ssr';
import { initialsOf, isEmail, type Identity } from '@/lib/identity.ts';

/**
 * Asked once per browser, straight after unlocking.
 *
 * Not a security control: the vault is already open by this point. It exists so
 * that entries get a real owner instead of sitting unattributed, which is what
 * decides whether anyone knows to rotate a secret when a person leaves.
 */
export function IdentityGate({ onDone }: { onDone: (identity: Identity) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const emailOk = email.length === 0 || isEmail(email);
  const ready = name.trim().length >= 2 && isEmail(email);

  return (
    <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-6 py-16">
      <div className="ambient pointer-events-none absolute inset-0" aria-hidden />
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="lift relative w-full max-w-[440px] overflow-hidden rounded-[12px] border border-line bg-panel"
      >
        <div className="border-b border-line px-7 pb-6 pt-7">
          <div className="flex items-center gap-3">
            {/* The chip fills in as they type, so the form previews its own result. */}
            <motion.span
              layout
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border font-mono text-[13px] font-medium transition-colors ${
                name.trim()
                  ? 'border-accent/40 bg-accent/12 text-accent'
                  : 'border-line bg-raised text-ink-3'
              }`}
            >
              {name.trim() ? initialsOf(name) : <UserCircle size={19} weight="bold" />}
            </motion.span>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                {name.trim() || 'Who is at the keyboard?'}
              </h1>
              <p className="truncate text-[12.5px] text-ink-3">
                {email.trim() || 'Everything you add gets filed under this'}
              </p>
            </div>
          </div>
        </div>

        <form
          className="px-7 pb-7 pt-6"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (ready) onDone({ name: name.trim(), email: email.trim() });
          }}
        >
          <label htmlFor="who-name" className="mb-1.5 block text-[12px] font-medium text-ink-2">
            Your name
          </label>
          <input
            ref={nameRef}
            id="who-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Abrar Navalur"
            className="w-full rounded-[8px] border border-line bg-bg px-3 py-2.5 text-[13.5px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60"
          />

          <label htmlFor="who-email" className="mb-1.5 mt-4 block text-[12px] font-medium text-ink-2">
            Your email
          </label>
          <input
            id="who-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="email"
            placeholder="you@garageaistack.com"
            aria-invalid={!emailOk}
            className={`w-full rounded-[8px] border bg-bg px-3 py-2.5 text-[13.5px] text-ink outline-none transition placeholder:text-ink-3 ${
              emailOk ? 'border-line focus:border-accent/60' : 'border-weak/50'
            }`}
          />
          {touched && !emailOk && (
            <p className="mt-1.5 text-[11.5px] text-weak">That is not a valid email address.</p>
          )}

          <button
            type="submit"
            disabled={!ready}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent px-4 py-3 text-[13.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
          >
            Continue
            <ArrowRight size={15} weight="bold" />
          </button>

          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">
            Stored in this browser only. It is not a login and it protects nothing, it just means
            every secret has a name against it.
          </p>
        </form>
      </motion.div>
    </main>
  );
}
