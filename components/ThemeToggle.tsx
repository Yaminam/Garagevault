'use client';

/**
 * Day/night switch.
 *
 * Deliberately not a floating pill in a corner. It sits inside the header's
 * segmented utility cluster alongside the idle timer, the privacy blur and the
 * lock, because it is chrome of exactly the same rank as those. The icon shows
 * the theme you would get by pressing it, which is the convention every OS
 * uses and the opposite of what reads as correct when you write it.
 */

import { useEffect, useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react/dist/ssr';
import { DEFAULT_THEME, applyTheme, currentTheme, type Theme } from '@/lib/theme.ts';

export function ThemeToggle({ className = '' }: { className?: string }) {
  // The server has no idea which theme this browser chose, so the first render
  // has to match the markup and the real value is read after mount.
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => setTheme(currentTheme()), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Switch to day mode' : 'Switch to night mode';

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      title={label}
      aria-label={label}
      className={`grid place-items-center text-ink-3 transition-colors hover:bg-hover hover:text-ink ${className}`}
    >
      {next === 'light' ? <Sun size={14} weight="bold" /> : <Moon size={14} weight="bold" />}
    </button>
  );
}
