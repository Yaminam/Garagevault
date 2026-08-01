/**
 * Password health scoring and vault-wide audit.
 *
 * The scoring is an entropy estimate with penalties, not a claim of real-world
 * crack time. It is deliberately pessimistic: a password built from a dictionary
 * word plus a year scores badly even when it is long.
 */

import type { VaultItem } from './types.ts';

export type Verdict = 'critical' | 'weak' | 'fair' | 'strong';

export type Score = {
  verdict: Verdict;
  /** 0 to 100, for the meter. */
  percent: number;
  entropyBits: number;
  reasons: string[];
};

/** Tokens that show up repeatedly in this tracker and in every breach corpus. */
const PREDICTABLE = [
  'password', 'admin', 'welcome', 'qwerty', 'letmein', 'garage', 'collective',
  'productions', 'solar', 'agents', 'subscriptions', 'foundercentral', 'copyloop',
  'kaayu', 'rituals', 'active', 'indian', 'capital', 'connect', 'pulse', 'developer',
];

function poolSize(password: string): number {
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;
  return pool || 1;
}

export function scorePassword(password: string): Score {
  const reasons: string[] = [];
  const lower = password.toLowerCase();

  let bits = password.length * Math.log2(poolSize(password));

  if (password.length < 12) reasons.push(`Only ${password.length} characters`);

  // A recognisable word contributes far less entropy than its length suggests.
  const words = PREDICTABLE.filter((w) => lower.includes(w));
  if (words.length > 0) {
    bits -= words.reduce((sum, w) => sum + w.length * 2.5, 0);
    reasons.push(`Contains a guessable word: ${words.join(', ')}`);
  }

  // A trailing year or short run of digits is the most common padding there is.
  if (/(19|20)\d{2}\b/.test(password)) {
    bits -= 8;
    reasons.push('Contains a year');
  } else if (/\d{2,}$/.test(password)) {
    bits -= 5;
    reasons.push('Ends in a run of digits');
  }

  if (/^[a-z]+$/.test(password)) reasons.push('Lowercase letters only');
  else if (!/[^a-zA-Z0-9]/.test(password)) reasons.push('No symbols');

  if (/(.)\1{2,}/.test(password)) {
    bits -= 4;
    reasons.push('Repeats a character three or more times');
  }

  bits = Math.max(0, bits);

  const verdict: Verdict =
    bits < 28 ? 'critical' : bits < 45 ? 'weak' : bits < 68 ? 'fair' : 'strong';

  return {
    verdict,
    percent: Math.min(100, Math.round((bits / 90) * 100)),
    entropyBits: Math.round(bits),
    reasons,
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  critical: 'Critical',
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
};

/** Tailwind text colour per verdict. One accent, three semantic states. */
export const VERDICT_COLOR: Record<Verdict, string> = {
  critical: 'text-weak',
  weak: 'text-weak',
  fair: 'text-fair',
  strong: 'text-strong',
};

export type Audit = {
  /** Items whose password scores weak or critical. */
  fragile: VaultItem[];
  /** Groups of two or more items sharing one password. */
  reused: { password: string; items: VaultItem[] }[];
  /** Items the spreadsheet never resolved. */
  incomplete: VaultItem[];
  /** Items with a real password but no second factor recorded. */
  noTwoFactor: VaultItem[];
  /** 0 to 100, weighted across the checks above. */
  health: number;
};

const hasTwoFactor = (item: VaultItem) =>
  item.twofa != null && !/^no$/i.test(item.twofa);

export function auditVault(items: VaultItem[]): Audit {
  const withPassword = items.filter((i) => i.password);

  const fragile = withPassword.filter((i) => {
    const v = scorePassword(i.password!).verdict;
    return v === 'weak' || v === 'critical';
  });

  const groups = new Map<string, VaultItem[]>();
  for (const item of withPassword) {
    const list = groups.get(item.password!) ?? [];
    list.push(item);
    groups.set(item.password!, list);
  }
  const reused = [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([password, list]) => ({ password, items: list }))
    .sort((a, b) => b.items.length - a.items.length);

  const incomplete = items.filter((i) => !i.password);
  const noTwoFactor = withPassword.filter((i) => !hasTwoFactor(i));

  const reusedCount = reused.reduce((n, g) => n + g.items.length, 0);
  const penalties =
    fragile.length * 3 + reusedCount * 2 + incomplete.length * 1.5 + noTwoFactor.length * 0.5;
  const health = Math.max(0, Math.round(100 - (penalties / Math.max(1, items.length)) * 22));

  return { fragile, reused, incomplete, noTwoFactor, health };
}
