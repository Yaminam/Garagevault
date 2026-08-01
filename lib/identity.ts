/**
 * Who is using this browser.
 *
 * Name and email only, so nothing here is secret and localStorage is the right
 * home for it. It does two jobs: new entries default to a real owner instead of
 * being left unattributed, and shares record who created them.
 */

const STORAGE_KEY = 'garage-vault.identity';

export type Identity = {
  name: string;
  email: string;
};

export const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

export function loadIdentity(): Identity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (!parsed.name?.trim() || !parsed.email?.trim()) return null;
    return { name: parsed.name.trim(), email: parsed.email.trim() };
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ name: identity.name.trim(), email: identity.email.trim() }),
  );
}

export function clearIdentity(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Initials for the avatar chip. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
