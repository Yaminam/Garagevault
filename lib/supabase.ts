import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase clients.
 *
 * The browser client uses the publishable (anon) key, which is public by
 * design. It only ever sees ciphertext, so there is nothing to hide in it.
 */

export type Client = SupabaseClient;

export class MissingConfigError extends Error {
  constructor() {
    super(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
    );
    this.name = 'MissingConfigError';
  }
}

/**
 * Scrub an env value before it becomes an HTTP header.
 *
 * A key goes into the `Authorization` header, which must be Latin-1. A byte-
 * order mark (U+FEFF) or stray whitespace, easily introduced when a value is
 * piped into a deploy tool from a shell, is code point 65279 and makes the
 * browser throw "String contains non ISO-8859-1 code point" on the first
 * request. Stripping anything outside printable ASCII keeps that impossible.
 */
function clean(value: string | undefined): string | undefined {
  if (!value) return value;
  const scrubbed = value.replace(/[^\x21-\x7E]/g, '').trim();
  return scrubbed || undefined;
}

let browserClient: Client | null = null;

export function getBrowserClient(): Client {
  if (browserClient) return browserClient;

  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) throw new MissingConfigError();

  browserClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'garage-vault' } },
  });
  return browserClient;
}

/** Used by the Node seeding tool, where the service_role key bypasses RLS. */
export function createServerClient(url: string, key: string): Client {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
