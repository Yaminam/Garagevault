'use client';

import { useEffect, useState } from 'react';
import { ArrowClockwise, Copy, House } from '@phosphor-icons/react/dist/ssr';

/**
 * The crash screen.
 *
 * Two jobs. Be nice about it, because whoever lands here was mid-task and is
 * already annoyed. And be useful: the default Next message ("a client-side
 * exception has occurred, see the console") tells you nothing without opening
 * devtools, so the real message and digest go on screen with a copy button.
 *
 * It also says plainly that the vault locked itself, because the first thing
 * anyone wonders after a crash in a password manager is whether their secrets
 * just went somewhere.
 */

const QUIPS = [
  { face: '(╯°□°)╯', line: 'The vault flipped the table.' },
  { face: '¯\\_(ツ)_/¯', line: 'Something came loose in here.' },
  { face: '(x_x)', line: 'That did not go to plan.' },
  { face: 'ʕ•ᴥ•ʔ', line: 'A bear got into the wiring.' },
  { face: '(⌐■_■)', line: 'Well. That was unexpected.' },
];

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Picked on mount rather than during render, so the server and client markup
  // agree and hydration does not warn.
  const [quip, setQuip] = useState(QUIPS[0]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setQuip(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
    console.error('Garage Vault crashed:', error);
  }, [error]);

  const details = [error.message, error.digest && `digest ${error.digest}`]
    .filter(Boolean)
    .join('\n');

  return (
    <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-6 py-16">
      <div className="ambient pointer-events-none absolute inset-0" aria-hidden />
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <div className="lift relative w-full max-w-[520px] overflow-hidden rounded-[12px] border border-line bg-panel">
        <div className="border-b border-line px-7 py-9 text-center">
          <p
            aria-hidden
            className="select-none font-mono text-[34px] leading-none tracking-tight text-accent"
          >
            {quip.face}
          </p>
          <h1 className="mt-5 text-[21px] font-semibold tracking-[-0.015em] text-ink">
            {quip.line}
          </h1>
          <p className="mx-auto mt-2 max-w-[38ch] text-[13.5px] leading-relaxed text-ink-2">
            Nothing was lost. The vault locked itself on the way down, so your entries are still
            encrypted exactly where they were.
          </p>
        </div>

        <div className="px-7 py-6">
          {details && (
            <div className="rounded-[8px] border border-line bg-bg p-3">
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-3">
                  {details}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(details).then(
                      () => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      },
                      () => {},
                    );
                  }}
                  aria-label="Copy the error"
                  title="Copy the error"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink"
                >
                  <Copy size={13} weight="bold" />
                </button>
              </div>
              {copied && <p className="mt-1.5 text-[11px] text-strong">Copied. Paste it at me.</p>}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex flex-1 items-center justify-center gap-2 rounded-[8px] bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px"
            >
              <ArrowClockwise size={14} weight="bold" />
              Try that again
            </button>
            <a
              href="/"
              className="flex items-center justify-center gap-2 rounded-[8px] border border-line px-4 py-2.5 text-[13px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              <House size={14} weight="bold" />
              Start over
            </a>
          </div>

          <p className="mt-4 text-center text-[11.5px] text-ink-3">
            If it keeps happening, copy the message above. It is worth more than a description.
          </p>
        </div>
      </div>
    </main>
  );
}
