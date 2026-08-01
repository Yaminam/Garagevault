/**
 * Theme selection.
 *
 * The choice lives in localStorage, not in the vault, because it is a property
 * of this browser rather than of the encrypted data. Nothing here touches the
 * key or the rows, so it is safe to read and write while locked.
 *
 * Day is the default, and it is a fixed default rather than the system
 * preference. Following the OS would mean the app silently changes character
 * on whatever day someone flips their laptop, and the lock screen is the first
 * thing a returning user sees. An explicit choice sticks; no choice means day.
 */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'gv.theme';
export const DEFAULT_THEME: Theme = 'light';

/**
 * Runs in `<head>` before the first paint, so the correct palette is on the
 * document by the time anything renders. Without it the page paints dark, then
 * flips to light a frame later, which is the flash every themed app has to
 * deal with. Inlined as a string because it must not wait for the bundle.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'${DEFAULT_THEME}'}catch(e){}})()`;

/** What the document is currently showing. Reads the DOM, not storage. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Swaps the palette and remembers the choice.
 *
 * The `theme-anim` class turns on a global colour transition for the length of
 * the fade and is then removed, so surfaces cross-fade on a deliberate switch
 * without smearing every hover and selection change for the rest of the
 * session. Skipped under reduced motion, where an instant swap is the point.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (animate) {
    root.classList.add('theme-anim');
    window.setTimeout(() => root.classList.remove('theme-anim'), 200);
  }

  root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode and blocked storage are fine: the theme just will not persist.
  }
}
