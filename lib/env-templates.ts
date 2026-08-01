/**
 * Environment templates.
 *
 * Picking a provider pre-fills the exact key names that provider expects, so an
 * entry never ends up half-populated with a made-up variable name. `secret`
 * decides whether the value is masked in the UI and whether it counts toward
 * the "unshared secret" checks: a project URL is not a secret, a service_role
 * key very much is.
 */

export type TemplateField = {
  key: string;
  /** Short human label shown beside the key name. */
  label: string;
  secret: boolean;
  /** Where to find it, shown as placeholder text. */
  hint?: string;
  optional?: boolean;
};

export type EnvTemplate = {
  id: string;
  label: string;
  /** Where these values come from, shown under the picker. */
  source: string;
  fields: TemplateField[];
};

export const ENV_TEMPLATES: EnvTemplate[] = [
  {
    id: 'supabase',
    label: 'Supabase',
    source: 'Dashboard, Project Settings, API',
    fields: [
      { key: 'NEXT_PUBLIC_SUPABASE_URL', label: 'Project URL', secret: false, hint: 'https://<ref>.supabase.co' },
      { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Publishable key', secret: false, hint: 'sb_publishable_... or the legacy anon JWT' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service role key', secret: true, hint: 'Bypasses row-level security. Server only.' },
      { key: 'SUPABASE_JWT_SECRET', label: 'JWT secret', secret: true, hint: 'Signs and verifies auth tokens', optional: true },
      { key: 'DATABASE_URL', label: 'Connection string', secret: true, hint: 'postgresql://postgres:...', optional: true },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    source: 'platform.openai.com, API keys',
    fields: [
      { key: 'OPENAI_API_KEY', label: 'API key', secret: true, hint: 'sk-proj-...' },
      { key: 'OPENAI_ORG_ID', label: 'Organization id', secret: false, hint: 'org-...', optional: true },
      { key: 'OPENAI_PROJECT_ID', label: 'Project id', secret: false, hint: 'proj_...', optional: true },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    source: 'console.anthropic.com, API keys',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'API key', secret: true, hint: 'sk-ant-...' },
    ],
  },
  {
    id: 'vercel',
    label: 'Vercel',
    source: 'vercel.com, Account Settings, Tokens',
    fields: [
      { key: 'VERCEL_TOKEN', label: 'Access token', secret: true },
      { key: 'VERCEL_ORG_ID', label: 'Team id', secret: false, hint: 'team_...' },
      { key: 'VERCEL_PROJECT_ID', label: 'Project id', secret: false, hint: 'prj_...' },
    ],
  },
  {
    id: 'resend',
    label: 'Resend',
    source: 'resend.com, API keys',
    fields: [
      { key: 'RESEND_API_KEY', label: 'API key', secret: true, hint: 're_...' },
      { key: 'RESEND_FROM_EMAIL', label: 'Sending address', secret: false, optional: true },
    ],
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    source: 'dash.cloudflare.com, API tokens',
    fields: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'API token', secret: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account id', secret: false },
      { key: 'CLOUDFLARE_ZONE_ID', label: 'Zone id', secret: false, optional: true },
    ],
  },
  {
    id: 'fal',
    label: 'Fal AI',
    source: 'fal.ai, Keys',
    fields: [{ key: 'FAL_KEY', label: 'API key', secret: true, hint: 'id:secret' }],
  },
  {
    id: 'google',
    label: 'Google Cloud',
    source: 'console.cloud.google.com, Credentials',
    fields: [
      { key: 'GOOGLE_API_KEY', label: 'API key', secret: true },
      { key: 'GOOGLE_CLIENT_ID', label: 'OAuth client id', secret: false, optional: true },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'OAuth client secret', secret: true, optional: true },
    ],
  },
  {
    id: 'stripe',
    label: 'Stripe',
    source: 'dashboard.stripe.com, Developers, API keys',
    fields: [
      { key: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable key', secret: false, hint: 'pk_live_...' },
      { key: 'STRIPE_SECRET_KEY', label: 'Secret key', secret: true, hint: 'sk_live_...' },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook secret', secret: true, hint: 'whsec_...', optional: true },
    ],
  },
  {
    id: 'custom',
    label: 'Blank',
    source: 'Add your own keys one by one',
    fields: [],
  },
];

export const templateById = (id: string | null): EnvTemplate | undefined =>
  ENV_TEMPLATES.find((template) => template.id === id);

/** Keys whose name alone says the value must be masked. */
const SECRET_NAME = /(secret|token|key|password|passwd|pwd|credential|private)/i;
/** Names that look secret but are not, so they stay visible. */
const PUBLIC_NAME = /(public|publishable|url|host|region|account_id|org_id|project_id|client_id)/i;

export function looksSecret(key: string): boolean {
  if (PUBLIC_NAME.test(key)) return false;
  return SECRET_NAME.test(key);
}

/** Parse a pasted `.env` block into variables, keeping comments out. */
export function parseEnvBlock(text: string): { key: string; value: string; secret: boolean }[] {
  const out: { key: string; value: string; secret: boolean }[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    // Strip one layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    out.push({ key: match[1], value, secret: looksSecret(match[1]) });
  }

  return out;
}

/** Render variables back into a `.env` file body. */
export function toEnvBlock(vars: { key: string; value: string }[]): string {
  return vars
    .filter((v) => v.key.trim())
    .map((v) => `${v.key}=${/\s|#/.test(v.value) ? JSON.stringify(v.value) : v.value}`)
    .join('\n');
}
