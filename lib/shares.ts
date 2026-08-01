/**
 * One-time share links, bound to a named recipient.
 *
 * The ciphertext goes to Postgres. The key is derived in the browser from two
 * things that never reach the server: the random token in the URL fragment
 * (browsers do not transmit fragments) and the recipient's name. So a share is
 * unreadable to the database, and a link that leaks into a channel is unreadable
 * to whoever finds it.
 */

import { createShareKey, importShareKey, maskName, open, seal } from './crypto.ts';
import type { Client } from './supabase.ts';

export type ShareOptions = {
  /** Non-secret hint shown before opening, for example "Supabase .env". */
  label: string;
  /** The person allowed to open it. Folded into the key, never stored. */
  recipientName: string;
  /** Hours until the link stops working. */
  hours: number;
  /** How many times it can be opened before it deletes itself. */
  maxViews: number;
};

/** Returns the full share URL, fragment included. */
export async function createShare(
  client: Client,
  origin: string,
  payload: unknown,
  options: ShareOptions,
): Promise<string> {
  const { key, token } = await createShareKey(options.recipientName);
  const sealed = await seal(key, payload);

  // The id is minted here rather than read back from the insert. `vault_shares`
  // has no SELECT policy on purpose, so reads can only happen through
  // claim_share, which counts the view and burns the row. Asking PostgREST to
  // return the inserted row would need that policy and would quietly hand every
  // client a way to read shares without consuming a view.
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + options.hours * 3600_000).toISOString();

  const { error } = await client.from('vault_shares').insert({
    id,
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
    label: options.label.slice(0, 120) || null,
    recipient_hint: maskName(options.recipientName).slice(0, 120) || null,
    expires_at: expiresAt,
    max_views: options.maxViews,
  });

  if (error) throw new Error(error.message);

  return `${origin}/s/${id}#${token}`;
}

export class ShareGoneError extends Error {
  constructor() {
    super('This link has expired or has already been opened.');
    this.name = 'ShareGoneError';
  }
}

export class WrongRecipientError extends Error {
  constructor() {
    super('That name does not match the one this link was created for.');
    this.name = 'WrongRecipientError';
  }
}

export type SharePeek = {
  label: string | null;
  recipientHint: string | null;
  expiresAt: string;
  viewsLeft: number;
};

/**
 * Read the non-secret metadata. Deliberately separate from claiming so that
 * showing the recipient which name to type does not burn one of their views.
 */
export async function peekShare(client: Client, id: string): Promise<SharePeek> {
  const { data, error } = await client.rpc('peek_share', { p_id: id });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ShareGoneError();

  return {
    label: row.label ?? null,
    recipientHint: row.recipient_hint ?? null,
    expiresAt: row.expires_at,
    viewsLeft: row.views_left ?? 0,
  };
}

export type ClaimedShare<T> = {
  payload: T;
  label: string | null;
  viewsLeft: number;
};

/**
 * Claim a share. This consumes one view server-side, so a single-view link
 * fails the second time by design.
 *
 * A wrong name fails at the GCM tag rather than at a comparison, which is why
 * it is reported separately from an expired link.
 */
export async function claimShare<T>(
  client: Client,
  id: string,
  token: string,
  recipientName: string,
): Promise<ClaimedShare<T>> {
  const { data, error } = await client.rpc('claim_share', { p_id: id });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ShareGoneError();

  const key = await importShareKey(token, recipientName);
  try {
    const payload = await open<T>(key, { iv: row.iv, ciphertext: row.ciphertext });
    return { payload, label: row.label ?? null, viewsLeft: row.views_left ?? 0 };
  } catch {
    throw new WrongRecipientError();
  }
}
