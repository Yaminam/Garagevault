/** Shared vault model. Used by the importer, the repository, and the app. */

import type { Attachment } from './attachments.ts';

export type CategoryId = 'email' | 'admin' | 'social' | 'database' | 'other';

export type Category = {
  id: CategoryId;
  label: string;
  icon: string;
};

export const CATEGORIES: Category[] = [
  { id: 'email', label: 'Email Accounts', icon: 'mail' },
  { id: 'admin', label: 'Admin & CRM', icon: 'shield' },
  { id: 'social', label: 'Social Media', icon: 'share' },
  { id: 'database', label: 'Databases & Keys', icon: 'database' },
  { id: 'other', label: 'Other', icon: 'key' },
];

/** Why an item is incomplete, as recorded in the source spreadsheet. */
export type ItemFlag =
  | 'no-password'
  | 'password-unknown'
  | 'username-unknown'
  | 'ambiguous-password';

/** One line of an environment file. */
export type EnvVar = {
  key: string;
  value: string;
  /** Whether to mask this value in the UI. URLs and org ids are not secrets. */
  secret: boolean;
};

/** Who owns or uses an entry. Both are required for anything shared with a person. */
export type Owner = {
  name: string | null;
  email: string | null;
};

export type ItemKind = 'login' | 'env' | 'billing' | 'asset' | 'org' | 'person';

/** Where an asset is in its life, which is what decides who to chase. */
export type AssetStatus = 'in-use' | 'spare' | 'repair' | 'retired';

export type BillingCycle = 'monthly' | 'yearly' | 'one-time' | 'variable';

/**
 * Everything about one entry. This whole object is encrypted into a single
 * `vault_items.ciphertext`, so the database never sees a title, a key name,
 * or an owner email either.
 */
export type ItemFields = {
  /**
   * `login` is a username and password, `env` a set of environment keys,
   * `billing` a subscription or invoice, `asset` a piece of kit.
   */
  kind: ItemKind;

  title: string;
  /** Project this belongs to, for example "Copyloop" or "Sia Solar". */
  project: string | null;
  /** The person responsible for this entry. */
  owner: Owner;

  entity: string;
  notes: string | null;

  // --- login ---------------------------------------------------------------
  username: string | null;
  password: string | null;
  /** Extra passwords the source notes mention but do not resolve. */
  alternates: string[];
  url: string | null;
  email: string | null;
  category: CategoryId;
  accountType: string | null;
  twofa: string | null;
  twofaContact: string | null;

  // --- env -----------------------------------------------------------------
  /** Template id this was created from, for example `supabase`. */
  provider: string | null;
  vars: EnvVar[];

  // --- billing --------------------------------------------------------------
  billing: {
    vendor: string | null;
    plan: string | null;
    /** Kept as a number so totals are summable, with the symbol separate. */
    amount: number | null;
    currency: string;
    cycle: BillingCycle;
    /** ISO date. */
    nextRenewal: string | null;
    billingEmail: string | null;
    invoiceNumber: string | null;
    /** ISO date the invoice was paid. */
    paidOn: string | null;
    /** Set when the values came from a scanned document rather than typed. */
    scannedAt: string | null;
    /**
     * The invoice itself, encrypted in object storage. The pointer lives here,
     * inside the item's ciphertext, so the filename and type are protected
     * along with everything else and the bucket listing gives nothing away.
     */
    file?: Attachment | null;
  } | null;

  // --- asset ----------------------------------------------------------------
  asset: {
    /** Printed on the label and encoded in its barcode, for example GC-LT-0007. */
    tag: string | null;
    category: string | null;
    make: string | null;
    model: string | null;
    serial: string | null;
    status: AssetStatus;
    /** ISO dates. */
    purchasedOn: string | null;
    warrantyUntil: string | null;
    cost: number | null;
    currency: string;
    location: string | null;
    /**
     * Handover tracking. An asset can be assigned long before it is physically
     * in someone's hands, and the gap between those two is what goes missing.
     */
    received: boolean;
    receivedOn: string | null;
    scannedAt: string | null;
  } | null;

  // --- org -----------------------------------------------------------------
  org: {
    legalName: string | null;
    tradeName: string | null;
    /** 15-character GSTIN. Validated, checksum included. */
    gstin: string | null;
    pan: string | null;
    cin: string | null;
    registeredAddress: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    country: string;
    contactEmail: string | null;
    contactPhone: string | null;
    website: string | null;
    /** ISO date of incorporation. */
    incorporatedOn: string | null;
  } | null;

  // --- person ---------------------------------------------------------------
  person: {
    fullName: string | null;
    /** Internal identifier, for example GC-EMP-004. */
    employeeId: string | null;
    workEmail: string | null;
    personalEmail: string | null;
    phone: string | null;
    department: string | null;
    designation: string | null;
    /** Work email of whoever this person reports to. */
    reportsTo: string | null;
    /** `true` when this person leads a team, so the rail can group under them. */
    isTeamLead: boolean;
    employmentType: string | null;
    /** ISO dates. */
    joinedOn: string | null;
    exitedOn: string | null;
    location: string | null;
    active: boolean;
  } | null;

  /** Grouping label. Imported rows keep their spreadsheet table heading. */
  section: string;
  flags: ItemFlag[];
};

export type VaultItem = ItemFields & {
  /** Row id in `vault_items`. */
  id: string;
  createdAt: string;
  updatedAt: string;
};

const BASE: Omit<ItemFields, 'kind' | 'section'> = {
  title: '',
  project: null,
  owner: { name: null, email: null },
  entity: 'Garage Collective',
  notes: null,
  username: null,
  password: null,
  alternates: [],
  url: null,
  email: null,
  category: 'other',
  accountType: null,
  twofa: null,
  twofaContact: null,
  provider: null,
  vars: [],
  billing: null,
  asset: null,
  org: null,
  person: null,
  flags: [],
};

export function emptyLogin(): ItemFields {
  return { ...BASE, kind: 'login', section: 'Added in app' };
}

export function emptyEnv(): ItemFields {
  return { ...BASE, kind: 'env', section: 'Environments', category: 'other' };
}

export function emptyBilling(): ItemFields {
  return {
    ...BASE,
    kind: 'billing',
    section: 'Billing',
    billing: {
      vendor: null,
      plan: null,
      amount: null,
      currency: 'USD',
      cycle: 'monthly',
      nextRenewal: null,
      billingEmail: null,
      invoiceNumber: null,
      paidOn: null,
      scannedAt: null,
      file: null,
    },
  };
}

export function emptyAsset(tag: string): ItemFields {
  return {
    ...BASE,
    kind: 'asset',
    section: 'Assets',
    asset: {
      tag,
      category: 'laptop',
      make: null,
      model: null,
      serial: null,
      status: 'in-use',
      purchasedOn: null,
      warrantyUntil: null,
      cost: null,
      currency: 'INR',
      location: null,
      received: false,
      receivedOn: null,
      scannedAt: null,
    },
  };
}

export function emptyOrg(): ItemFields {
  return {
    ...BASE,
    kind: 'org',
    section: 'Organisation',
    org: {
      legalName: null,
      tradeName: null,
      gstin: null,
      pan: null,
      cin: null,
      registeredAddress: null,
      city: null,
      state: null,
      pincode: null,
      country: 'India',
      contactEmail: null,
      contactPhone: null,
      website: null,
      incorporatedOn: null,
    },
  };
}

export function emptyPerson(employeeId: string): ItemFields {
  return {
    ...BASE,
    kind: 'person',
    section: 'People',
    person: {
      fullName: null,
      employeeId,
      workEmail: null,
      personalEmail: null,
      phone: null,
      department: null,
      designation: null,
      reportsTo: null,
      isTeamLead: false,
      employmentType: 'Full time',
      joinedOn: null,
      exitedOn: null,
      location: null,
      active: true,
    },
  };
}

/** Next free employee id, in the form GC-EMP-0007. Reuses gaps. */
export function nextEmployeeId(existing: (string | null)[]): string {
  const prefix = 'GC-EMP-';
  const used = new Set(
    existing
      .filter((id): id is string => !!id && id.startsWith(prefix))
      .map((id) => Number.parseInt(id.slice(prefix.length), 10))
      .filter((n) => Number.isFinite(n)),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  'in-use': 'In use',
  spare: 'Spare',
  repair: 'In repair',
  retired: 'Retired',
};

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  'one-time': 'One time',
  variable: 'Variable',
};

/** The single `vault_meta` row. */
export type VaultMeta = {
  kdfSalt: string;
  kdfIterations: number;
  verifierIv: string;
  verifierCt: string;
};

/** A ciphertext row exactly as stored. */
export type EncryptedRow = {
  id: string;
  iv: string;
  ciphertext: string;
  created_at: string;
  updated_at: string;
};
