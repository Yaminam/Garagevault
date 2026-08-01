/**
 * Project names.
 *
 * A project is just a label, so the list is derived from the entries that use
 * one. The only thing worth persisting is a project created before anything has
 * been filed under it, which would otherwise vanish on reload. Those live in
 * localStorage: names are not secret, and keeping them out of the vault avoids
 * a schema for what is effectively UI state.
 */

const STORAGE_KEY = 'garage-vault.projects';

function readStored(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function writeStored(names: string[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(names)].sort()));
}

export function rememberProject(name: string): void {
  const clean = name.trim();
  if (!clean) return;
  writeStored([...readStored(), clean]);
}

export function forgetProject(name: string): void {
  writeStored(readStored().filter((p) => p !== name));
}

/**
 * Every project worth showing: those in use, plus any created-but-empty ones.
 * Returns the name and how many entries carry it.
 */
export function listProjects(inUse: (string | null)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of inUse) {
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const name of readStored()) {
    if (!counts.has(name)) counts.set(name, 0);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
