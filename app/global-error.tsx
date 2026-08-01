'use client';

import { useEffect } from 'react';
import { THEME_INIT_SCRIPT } from '@/lib/theme.ts';
import './globals.css';

/**
 * Last resort, for a crash in the root layout itself.
 *
 * This one replaces <html> entirely, so it cannot rely on anything the layout
 * sets up: no fonts, no providers, and no theme attribute. The stylesheet does
 * come along, so the tokens are available and the markup can use them; it runs
 * the same init script as the layout so a crash does not also throw the user
 * into the wrong palette. Everything else stays deliberately plain.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Garage Vault crashed at the root:', error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="grid min-h-[100dvh] place-items-center bg-bg p-6 text-ink">
        <div className="max-w-[420px] text-center">
          <p aria-hidden className="m-0 font-mono text-[32px] text-accent">
            (╥﹏╥)
          </p>
          <h1 className="mb-2 mt-5 text-[20px] font-semibold">The whole thing fell over.</h1>
          <p className="m-0 text-[14px] leading-relaxed text-ink-2">
            Not just a page this time. Your entries are untouched and still encrypted, but the app
            needs a restart.
          </p>

          {error.message && (
            <pre className="mt-5 whitespace-pre-wrap break-words rounded-[8px] border border-line bg-panel p-3 text-left font-mono text-[11.5px] text-ink-3">
              {error.message}
              {error.digest ? `\ndigest ${error.digest}` : ''}
            </pre>
          )}

          <button
            type="button"
            onClick={reset}
            className="mt-5 w-full cursor-pointer rounded-[8px] border-none bg-accent px-4 py-[11px] text-[13px] font-semibold text-accent-ink"
          >
            Reload the vault
          </button>
        </div>
      </body>
    </html>
  );
}
