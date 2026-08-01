'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, Copy } from '@phosphor-icons/react/dist/ssr';
import { generatePassword } from '@/lib/crypto.ts';
import { VERDICT_LABEL, scorePassword } from '@/lib/audit.ts';
import { useVault } from './vault-context.tsx';
import { StrengthMeter } from './primitives.tsx';

export function GeneratorPanel() {
  const { copy } = useVault();

  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [value, setValue] = useState('');

  const regenerate = useCallback(() => {
    setValue(generatePassword({ length, uppercase, digits, symbols }));
  }, [length, uppercase, digits, symbols]);

  useEffect(regenerate, [regenerate]);

  const score = value ? scorePassword(value) : null;

  const toggles = [
    { label: 'Uppercase', on: uppercase, set: setUppercase, sample: 'A to Z' },
    { label: 'Digits', on: digits, set: setDigits, sample: '2 to 9' },
    { label: 'Symbols', on: symbols, set: setSymbols, sample: '! @ # $' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-5 py-6 md:px-8 md:py-8">
        <h1 className="text-[21px] font-semibold tracking-[-0.015em] text-ink">Generator</h1>
        <p className="mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-ink-2">
          Uses the browser CSPRNG with rejection sampling, so every character is uniform across the
          alphabet. Nothing generated here is written back to the spreadsheet.
        </p>

        <div className="mt-6 rounded-[12px] border border-line bg-panel p-4">
          <div className="flex items-start gap-2">
            <p className="min-h-[52px] flex-1 break-all font-secret text-[16px] leading-relaxed text-ink">
              {value}
            </p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={regenerate}
                aria-label="Generate a new password"
                title="Generate a new password"
                className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink active:scale-95"
              >
                <ArrowsClockwise size={15} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => value && copy(value, 'Password')}
                aria-label="Copy generated password"
                title="Copy generated password"
                className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink active:scale-95"
              >
                <Copy size={15} weight="bold" />
              </button>
            </div>
          </div>

          {score && (
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <span className="text-[12.5px] text-ink-2">
                {VERDICT_LABEL[score.verdict]}
                <span className="ml-2 font-mono text-[11.5px] text-ink-3">{score.entropyBits} bits</span>
              </span>
              <StrengthMeter verdict={score.verdict} percent={score.percent} />
            </div>
          )}
        </div>

        <div className="mt-5 rounded-[12px] border border-line bg-panel p-4">
          <div className="flex items-baseline justify-between">
            <label htmlFor="length" className="text-[13px] text-ink">
              Length
            </label>
            <span className="font-mono text-[13px] text-ink-2">{length}</span>
          </div>
          <input
            id="length"
            type="range"
            min={12}
            max={48}
            value={length}
            onChange={(event) => setLength(Number(event.target.value))}
            className="mt-3 w-full accent-accent"
          />

          <div className="mt-5 space-y-px border-t border-line pt-4">
            {toggles.map((toggle) => (
              <label
                key={toggle.label}
                className="flex cursor-pointer items-center justify-between rounded-[6px] px-2 py-2 hover:bg-hover"
              >
                <span className="text-[13px] text-ink">
                  {toggle.label}
                  <span className="ml-2 font-mono text-[11.5px] text-ink-3">{toggle.sample}</span>
                </span>
                <input
                  type="checkbox"
                  checked={toggle.on}
                  onChange={(event) => toggle.set(event.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
