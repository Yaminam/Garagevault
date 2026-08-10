'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowsClockwise,
  Barcode as BarcodeIcon,
  Camera,
  Eye,
  EyeSlash,
  FileText,
  Key,
  Plus,
  Printer,
  Receipt,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { generatePassword } from '@/lib/crypto.ts';
import { scorePassword, VERDICT_LABEL } from '@/lib/audit.ts';
import { ENV_TEMPLATES, looksSecret, parseEnvBlock, templateById } from '@/lib/env-templates.ts';
import type { Identity } from '@/lib/identity.ts';
import { rememberProject } from '@/lib/projects.ts';
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, isSpecable, nextAssetTag } from '@/lib/assets.ts';
import { applyInvoice, filledLabels } from '@/lib/billing.ts';
import {
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  GST_STATES,
  checkCin,
  checkGstin,
  checkPan,
} from '@/lib/org.ts';
import { scanDocument, type ScanProgress } from '@/lib/ocr.ts';
import {
  ASSET_STATUS_LABEL,
  BILLING_CYCLE_LABEL,
  CATEGORIES,
  emptyAsset,
  emptyBilling,
  emptyEnv,
  emptyLogin,
  emptyOrg,
  emptyPerson,
  nextEmployeeId,
  type AssetStatus,
  type BillingCycle,
  type EnvVar,
  type ItemFields,
  type ItemKind,
  type VaultItem,
} from '@/lib/types.ts';
import { assetQrPayload } from '@/lib/qr.ts';
import { useVault } from './vault-context.tsx';
import { AssetLabel, QrCode } from './BarcodeLabel.tsx';
import { StrengthMeter } from './primitives.tsx';

const KINDS: { id: ItemKind; label: string }[] = [
  { id: 'login', label: 'Login' },
  { id: 'env', label: 'Environment' },
  { id: 'billing', label: 'Billing' },
  { id: 'asset', label: 'Asset' },
  { id: 'person', label: 'Person' },
  { id: 'org', label: 'Company' },
];

const PLACEHOLDER_TITLE: Record<ItemKind, string> = {
  login: 'admin.example.com',
  env: 'Copyloop production',
  billing: 'Claude MAX',
  asset: 'Abrar’s MacBook Air',
  person: 'Shreyash Tripathi',
  org: 'Garage Productions Pvt Ltd',
};

/** The owning relationship is a different thing for each kind, so say which. */
const OWNER_GROUP: Record<ItemKind, { title: string; hint: string }> = {
  login: { title: 'Used by', hint: 'Who rotates it' },
  env: { title: 'Maintained by', hint: 'Who owns these keys' },
  billing: { title: 'Approved by', hint: 'Who signs off the spend' },
  asset: { title: 'Assigned to', hint: 'Who holds the device' },
  person: { title: 'Recorded by', hint: 'Who added this record' },
  org: { title: 'Point of contact', hint: 'Who handles filings' },
};

/** A device or a company belongs to an entity, not to a software project. */
const SHOWS_PROJECT: Record<ItemKind, boolean> = {
  login: true,
  env: true,
  billing: true,
  asset: false,
  person: false,
  org: false,
};

function blankFor(kind: ItemKind, existing: (string | null)[]): ItemFields {
  switch (kind) {
    case 'env':
      return emptyEnv();
    case 'billing':
      return emptyBilling();
    case 'asset':
      return emptyAsset(nextAssetTag('laptop', existing));
    case 'org':
      return emptyOrg();
    case 'person':
      return emptyPerson(nextEmployeeId(existing));
    default:
      return emptyLogin();
  }
}

type Props = {
  /** `null` opens a blank form, an item opens it for editing. */
  item: VaultItem | null;
  /** Which form to show when creating. Ignored when editing. */
  initialKind: ItemKind;
  /** Hides the kind chooser when the section already decided it. */
  lockKind: boolean;
  /** Whoever is at the keyboard. New entries default to them as owner. */
  identity: Identity | null;
  projects: string[];
  onProjectCreated: () => void;
  onClose: () => void;
};

export function ItemEditor({
  item,
  initialKind,
  lockKind,
  identity,
  projects,
  onProjectCreated,
  onClose,
}: Props) {
  const { items, createItem, saveItem } = useVault();
  const reduce = useReducedMotion();

  const [fields, setFields] = useState<ItemFields>(() => {
    if (item) return item;
    // The generated identifier has to be unique across everything already here.
    const blank = blankFor(
      initialKind,
      initialKind === 'person'
        ? items.map((i) => i.person?.employeeId ?? null)
        : items.map((i) => i.asset?.tag ?? null),
    );
    // Defaulting the owner is the whole point of asking who is at the keyboard:
    // an entry with nobody against it is one nobody rotates.
    return identity ? { ...blank, owner: { name: identity.name, email: identity.email } } : blank;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof ItemFields>(key: K, value: ItemFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  // Existing values feed the autocomplete lists so spellings stay consistent.
  const entities = useMemo(() => [...new Set(items.map((i) => i.entity))].sort(), [items]);
  const people = useMemo(() => items.filter((i) => i.kind === 'person'), [items]);

  // Assets and people both get a generated identifier, from different pools.
  const existingFor = useCallback(
    (kind: ItemKind) =>
      kind === 'person'
        ? items.map((i) => i.person?.employeeId ?? null)
        : items.map((i) => i.asset?.tag ?? null),
    [items],
  );
  const emailValid =
    !fields.owner.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.owner.email);

  // An environment file without a project has nowhere to live in the rail.
  const projectRequired = fields.kind === 'env';
  const projectOk = !projectRequired || !!fields.project?.trim();
  const canSave = fields.title.trim().length > 0 && emailValid && projectOk && !saving;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setError(null);
    try {
      const cleaned: ItemFields = {
        ...fields,
        title: fields.title.trim(),
        project: fields.project?.trim() || null,
        vars: fields.vars.filter((v) => v.key.trim()),
      };
      if (cleaned.project) {
        rememberProject(cleaned.project);
        onProjectCreated();
      }
      if (item) await saveItem(item.id, cleaned);
      else await createItem(cleaned);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4 sm:p-6">
      <motion.button
        type="button"
        aria-label="Close editor"
        onClick={onClose}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 cursor-default bg-bg/75 backdrop-blur-sm"
      />

      <motion.form
        onSubmit={submit}
        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        role="dialog"
        aria-modal="true"
        aria-label={item ? 'Edit entry' : 'New entry'}
        className="relative flex max-h-[calc(100dvh-3rem)] w-full max-w-[660px] flex-col overflow-hidden rounded-[12px] border border-line-strong bg-panel shadow-[var(--shadow-dialog)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            {fields.kind === 'env' ? (
              <FileText size={15} weight="bold" />
            ) : fields.kind === 'billing' ? (
              <Receipt size={15} weight="bold" />
            ) : fields.kind === 'asset' ? (
              <BarcodeIcon size={15} weight="bold" />
            ) : (
              <Key size={15} weight="bold" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold tracking-tight text-ink">
              {item
                ? 'Edit entry'
                : `New ${KINDS.find((k) => k.id === fields.kind)?.label.toLowerCase() ?? 'entry'}`}
            </p>
            <p className="text-[11.5px] text-ink-3">Encrypted before it leaves this tab</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* Only a real choice when the section did not already imply one. */}
          {!item && !lockKind && (
            <div className="mb-5 inline-flex flex-wrap rounded-[8px] border border-line bg-bg p-0.5">
              {KINDS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setFields((current) => ({
                      ...blankFor(id, existingFor(id)),
                      title: current.title,
                      project: current.project,
                      owner: current.owner,
                      entity: current.entity,
                      notes: current.notes,
                    }))
                  }
                  className={`rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                    fields.kind === id ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <Group title="Basics">
            <Field label="Name" required>
              <input
                ref={firstField}
                value={fields.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder={PLACEHOLDER_TITLE[fields.kind]}
                className={inputClass}
              />
            </Field>

            {/* Every asset already belongs to the one org that owns the vault,
                so asking per-device is a field nobody changes — it just adds a
                click. Other kinds keep it, since a login or a bill can
                genuinely sit under a different entity. */}
            {fields.kind !== 'asset' && (
              <div className={SHOWS_PROJECT[fields.kind] ? 'grid gap-4 sm:grid-cols-2' : ''}>
                {SHOWS_PROJECT[fields.kind] && (
                  <Field
                    label="Project"
                    required={projectRequired}
                    hint={
                      projectRequired
                        ? 'Environment files file under a project'
                        : 'Which product this belongs to'
                    }
                  >
                    <ProjectPicker
                      value={fields.project}
                      options={projects}
                      onChange={(next) => set('project', next)}
                    />
                  </Field>
                )}

                <Field label="Entity">
                  <input
                    value={fields.entity}
                    onChange={(e) => set('entity', e.target.value)}
                    list="vault-entities"
                    className={inputClass}
                  />
                  <datalist id="vault-entities">
                    {entities.map((e) => (
                      <option key={e} value={e} />
                    ))}
                  </datalist>
                </Field>
              </div>
            )}
          </Group>

          {/* Both halves matter: something with no named owner is something
              nobody rotates, returns, or cancels. */}
          <Group
            title={OWNER_GROUP[fields.kind].title}
            hint={OWNER_GROUP[fields.kind].hint}
          >
            <OwnerPicker
              value={fields.owner}
              people={people}
              emailValid={emailValid}
              onChange={(owner) => set('owner', owner)}
            />
          </Group>

          {fields.kind === 'login' && <LoginFields fields={fields} set={set} />}
          {fields.kind === 'env' && <EnvFields fields={fields} set={set} />}
          {fields.kind === 'billing' && (
            <BillingFields fields={fields} set={set} replace={setFields} />
          )}
          {fields.kind === 'asset' && (
            <AssetFields
              fields={fields}
              set={set}
              // Only a brand-new asset may renumber its tag to match the
              // category; a saved tag is on a physical label and must not move.
              retag={
                item
                  ? undefined
                  : (category) => nextAssetTag(category, items.map((i) => i.asset?.tag ?? null))
              }
            />
          )}
          {fields.kind === 'org' && <OrgFields fields={fields} set={set} />}
          {fields.kind === 'person' && (
            <PersonFields fields={fields} set={set} people={people} />
          )}

          <Group title="Notes">
            <Field label="Anything the next person needs to know">
              <textarea
                value={fields.notes ?? ''}
                onChange={(e) => set('notes', e.target.value || null)}
                rows={3}
                className={`${inputClass} resize-y leading-relaxed`}
              />
            </Field>
          </Group>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3.5">
          {error && <p className="min-w-0 flex-1 truncate text-[12.5px] text-weak">{error}</p>}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-[8px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            >
              {saving ? 'Saving' : item ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </div>
      </motion.form>
    </div>
  );
}

/* --------------------------------------------------------------- login ---- */

type SetField = <K extends keyof ItemFields>(key: K, value: ItemFields[K]) => void;

function LoginFields({ fields, set }: { fields: ItemFields; set: SetField }) {
  const [revealed, setRevealed] = useState(false);
  const score = fields.password ? scorePassword(fields.password) : null;

  return (
    <>
      <Group title="Access">
      <Field label="Login URL">
        <input
          value={fields.url ?? ''}
          onChange={(e) => set('url', e.target.value || null)}
          placeholder="https://"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username">
          <input
            value={fields.username ?? ''}
            onChange={(e) => set('username', e.target.value || null)}
            className={inputClass}
          />
        </Field>

        <Field label="Category">
          <select
            value={fields.category}
            onChange={(e) => set('category', e.target.value as ItemFields['category'])}
            className={inputClass}
          >
            {CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Password">
        <div className="flex items-center gap-1 rounded-[8px] border border-line bg-bg pr-1 focus-within:border-accent/60">
          <input
            type={revealed ? 'text' : 'password'}
            value={fields.password ?? ''}
            onChange={(e) => set('password', e.target.value || null)}
            autoComplete="new-password"
            spellCheck={false}
            className="w-full bg-transparent px-3 py-2 font-secret text-[13px] text-ink outline-none"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            {revealed ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
          </button>
          <button
            type="button"
            onClick={() => {
              set('password', generatePassword({ length: 20, uppercase: true, digits: true, symbols: true }));
              setRevealed(true);
            }}
            aria-label="Generate a strong password"
            title="Generate a strong password"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <ArrowsClockwise size={14} weight="bold" />
          </button>
        </div>
        {score && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11.5px] text-ink-3">
              {VERDICT_LABEL[score.verdict]}
              <span className="ml-1.5 font-mono">{score.entropyBits} bits</span>
            </span>
            <StrengthMeter verdict={score.verdict} percent={score.percent} />
          </div>
        )}
      </Field>
      </Group>

      <Group title="Two-factor" hint="How to get back in">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Method">
            <input
              value={fields.twofa ?? ''}
              onChange={(e) => set('twofa', e.target.value || null)}
              placeholder="Authenticator app"
              className={inputClass}
            />
          </Field>
          <Field label="Recovery contact" hint="Phone or backup address">
            <input
              value={fields.twofaContact ?? ''}
              onChange={(e) => set('twofaContact', e.target.value || null)}
              className={inputClass}
            />
          </Field>
        </div>
      </Group>
    </>
  );
}

/* ----------------------------------------------------------------- env ---- */

function EnvFields({ fields, set }: { fields: ItemFields; set: SetField }) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [shown, setShown] = useState<Set<number>>(new Set());

  const applyTemplate = (id: string) => {
    const template = templateById(id);
    set('provider', id === 'custom' ? null : id);
    if (!template) return;

    // Keep any value already typed for a key the template also defines.
    const existing = new Map(fields.vars.map((v) => [v.key, v.value]));
    set(
      'vars',
      template.fields.map((field) => ({
        key: field.key,
        value: existing.get(field.key) ?? '',
        secret: field.secret,
      })),
    );
  };

  const updateVar = (index: number, patch: Partial<EnvVar>) =>
    set(
      'vars',
      fields.vars.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );

  const template = templateById(fields.provider);

  return (
    <>
      <Group title="Provider" hint={template?.source ?? 'Pre-fills the expected keys'}>
        <Field label="Service">
          <select
            value={fields.provider ?? 'custom'}
            onChange={(e) => applyTemplate(e.target.value)}
            className={inputClass}
          >
            {ENV_TEMPLATES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-caps">Variables</span>
          <button
            type="button"
            onClick={() => setPasting((p) => !p)}
            className="text-[11.5px] text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            {pasting ? 'Close paste box' : 'Paste a .env block'}
          </button>
        </div>

        {pasting && (
          <div className="mb-3 rounded-[8px] border border-line bg-bg p-3">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={'OPENAI_API_KEY=sk-proj-...\nRESEND_API_KEY=re_...'}
              className="w-full resize-y bg-transparent font-secret text-[12.5px] text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={() => {
                const parsed = parseEnvBlock(pasted);
                if (parsed.length === 0) return;
                const byKey = new Map(fields.vars.map((v) => [v.key, v]));
                for (const entry of parsed) byKey.set(entry.key, entry);
                set('vars', [...byKey.values()]);
                setPasted('');
                setPasting(false);
              }}
              disabled={parseEnvBlock(pasted).length === 0}
              className="mt-2 rounded-[6px] border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              Import {parseEnvBlock(pasted).length || ''} keys
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          {fields.vars.map((variable, index) => {
            const meta = template?.fields.find((f) => f.key === variable.key);
            const visible = shown.has(index);
            return (
              <div key={index} className="rounded-[8px] border border-line bg-bg p-2">
                <div className="flex items-center gap-1.5">
                  <input
                    value={variable.key}
                    onChange={(e) =>
                      updateVar(index, { key: e.target.value, secret: looksSecret(e.target.value) })
                    }
                    spellCheck={false}
                    placeholder="KEY_NAME"
                    className="w-[46%] shrink-0 bg-transparent px-1.5 py-1 font-mono text-[12px] font-medium text-ink outline-none placeholder:text-ink-3"
                  />
                  <input
                    type={variable.secret && !visible ? 'password' : 'text'}
                    value={variable.value}
                    onChange={(e) => updateVar(index, { value: e.target.value })}
                    spellCheck={false}
                    placeholder={meta?.hint ?? 'value'}
                    className="min-w-0 flex-1 bg-transparent px-1.5 py-1 font-secret text-[12px] text-ink-2 outline-none placeholder:text-ink-3"
                  />
                  {variable.secret && (
                    <button
                      type="button"
                      onClick={() =>
                        setShown((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                      aria-label={visible ? 'Hide value' : 'Show value'}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
                    >
                      {visible ? <EyeSlash size={13} weight="bold" /> : <Eye size={13} weight="bold" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => set('vars', fields.vars.filter((_, i) => i !== index))}
                    aria-label={`Remove ${variable.key || 'variable'}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-weak"
                  >
                    <Trash size={13} weight="bold" />
                  </button>
                </div>
                {meta && (
                  <p className="px-1.5 pt-1 text-[11px] text-ink-3">
                    {meta.label}
                    {meta.optional ? ', optional' : ''}
                    {meta.secret ? '. Never expose to the browser.' : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => set('vars', [...fields.vars, { key: '', value: '', secret: true }])}
          className="mt-2 flex items-center gap-1.5 rounded-[8px] border border-dashed border-line px-3 py-2 text-[12px] text-ink-3 transition hover:border-line-strong hover:text-ink"
        >
          <Plus size={13} weight="bold" />
          Add variable
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- billing ---- */

/**
 * A readable name for a scanned document. Vendor alone is usually right, but a
 * month makes a run of invoices from the same vendor tellable apart in a list.
 */
function BillingFields({
  fields,
  set,
  replace,
}: {
  fields: ItemFields;
  set: SetField;
  replace: (next: ItemFields) => void;
}) {
  const billing = fields.billing ?? emptyBilling().billing!;
  const [filled, setFilled] = useState<string[]>([]);

  const patch = (next: Partial<NonNullable<ItemFields['billing']>>) =>
    set('billing', { ...billing, ...next });

  return (
    <>
      <Scanner
        hint="Drop a PDF invoice, or a photo of a receipt. Every field below is filled from it."
        onRead={(result) => {
          const guess = result.invoice;
          setFilled(filledLabels(guess));
          // Same mapping the bulk folder importer uses, so a bill created either
          // way ends up identical. Scanning is an explicit request to read the
          // file, so the title follows the document rather than being kept.
          replace(applyInvoice(guess, fields));
        }}
      />

      {filled.length > 0 && (
        <div className="-mt-3 mb-5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-3">Filled from the document:</span>
          {filled.map((label) => (
            <span
              key={label}
              className="rounded-full border border-strong/25 bg-strong/10 px-2 py-[2px] text-[10.5px] font-medium text-strong"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <Group title="Subscription">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor">
          <input
            value={billing.vendor ?? ''}
            onChange={(e) => patch({ vendor: e.target.value || null })}
            placeholder="Anthropic"
            className={inputClass}
          />
        </Field>
        <Field label="Plan">
          <input
            value={billing.plan ?? ''}
            onChange={(e) => patch({ plan: e.target.value || null })}
            placeholder="MAX 5x"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Amount">
          <input
            type="number"
            step="0.01"
            min="0"
            value={billing.amount ?? ''}
            onChange={(e) => patch({ amount: e.target.value === '' ? null : Number(e.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label="Currency">
          <select
            value={billing.currency}
            onChange={(e) => patch({ currency: e.target.value })}
            className={inputClass}
          >
            {['USD', 'INR', 'EUR', 'GBP'].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cycle">
          <select
            value={billing.cycle}
            onChange={(e) => patch({ cycle: e.target.value as BillingCycle })}
            className={inputClass}
          >
            {(Object.keys(BILLING_CYCLE_LABEL) as BillingCycle[]).map((cycle) => (
              <option key={cycle} value={cycle}>
                {BILLING_CYCLE_LABEL[cycle]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      </Group>

      <Group title="Dates">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Next renewal">
            <input
              type="date"
              value={billing.nextRenewal ?? ''}
              onChange={(e) => patch({ nextRenewal: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="Paid on">
            <input
              type="date"
              value={billing.paidOn ?? ''}
              onChange={(e) => patch({ paidOn: e.target.value || null })}
              className={inputClass}
            />
          </Field>
        </div>
      </Group>

      <Group title="Reference">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Invoice number">
            <input
              value={billing.invoiceNumber ?? ''}
              onChange={(e) => patch({ invoiceNumber: e.target.value || null })}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label="Billing email">
            <input
              type="email"
              value={billing.billingEmail ?? ''}
              onChange={(e) => patch({ billingEmail: e.target.value || null })}
              className={inputClass}
            />
          </Field>
        </div>
      </Group>
    </>
  );
}

/* --------------------------------------------------------------- asset ---- */

function AssetFields({
  fields,
  set,
  retag,
}: {
  fields: ItemFields;
  set: SetField;
  /** Given a category, returns the next free tag. Absent when editing. */
  retag?: (category: string) => string;
}) {
  const asset = fields.asset ?? emptyAsset('GC-AS-0001').asset!;
  const patch = (next: Partial<NonNullable<ItemFields['asset']>>) =>
    set('asset', { ...asset, ...next });
  const emptySpecs = () => ({ cpu: null, ram: null, storage: null, gpu: null });

  return (
    <>
      <Group title="Tag" hint="Generated, unique across the vault">
        <div className="rounded-[8px] border border-line bg-bg/50 px-3.5 py-3">
          <p className="font-mono text-[16px] font-medium tracking-tight text-ink">
            {asset.tag ?? 'None'}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            Printed on the label and carried in the QR below
          </p>
        </div>
      </Group>

      <Group title="Hardware">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <select
              value={asset.category ?? 'other'}
              onChange={(e) => {
                const category = e.target.value;
                patch(retag ? { category, tag: retag(category) } : { category });
              }}
              className={inputClass}
            >
              {ASSET_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {ASSET_CATEGORY_LABEL[category] ?? category}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={asset.status}
              onChange={(e) => patch({ status: e.target.value as AssetStatus })}
              className={inputClass}
            >
              {(Object.keys(ASSET_STATUS_LABEL) as AssetStatus[]).map((status) => (
                <option key={status} value={status}>
                  {ASSET_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Make">
            <input
              value={asset.make ?? ''}
              onChange={(e) => patch({ make: e.target.value || null })}
              placeholder="Apple"
              className={inputClass}
            />
          </Field>
          <Field label="Model">
            <input
              value={asset.model ?? ''}
              onChange={(e) => patch({ model: e.target.value || null })}
              placeholder="MacBook Air M2"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Serial number">
          <input
            value={asset.serial ?? ''}
            onChange={(e) => patch({ serial: e.target.value || null })}
            spellCheck={false}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </Group>

      {/* Only a laptop or a desktop has a chip, memory and a drive to speak
          of — a monitor or a UPS has nothing here worth asking for. */}
      {isSpecable(asset.category) && (
        <Group title="Specs" hint="What is actually inside it">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CPU">
              <input
                value={asset.specs?.cpu ?? ''}
                onChange={(e) =>
                  patch({ specs: { ...(asset.specs ?? emptySpecs()), cpu: e.target.value || null } })
                }
                placeholder="Apple M2 Pro"
                className={inputClass}
              />
            </Field>
            <Field label="RAM">
              <input
                value={asset.specs?.ram ?? ''}
                onChange={(e) =>
                  patch({ specs: { ...(asset.specs ?? emptySpecs()), ram: e.target.value || null } })
                }
                placeholder="16 GB"
                className={inputClass}
              />
            </Field>
            <Field label="Storage">
              <input
                value={asset.specs?.storage ?? ''}
                onChange={(e) =>
                  patch({
                    specs: { ...(asset.specs ?? emptySpecs()), storage: e.target.value || null },
                  })
                }
                placeholder="512 GB SSD"
                className={inputClass}
              />
            </Field>
            <Field label="GPU">
              <input
                value={asset.specs?.gpu ?? ''}
                onChange={(e) =>
                  patch({ specs: { ...(asset.specs ?? emptySpecs()), gpu: e.target.value || null } })
                }
                placeholder="Integrated"
                className={inputClass}
              />
            </Field>
          </div>
        </Group>
      )}

      <Group title="Purchase">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Purchased on">
            <input
              type="date"
              value={asset.purchasedOn ?? ''}
              onChange={(e) => patch({ purchasedOn: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="Warranty start">
            <input
              type="date"
              value={asset.warrantyStart ?? ''}
              onChange={(e) => patch({ warrantyStart: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="Warranty until">
            <input
              type="date"
              value={asset.warrantyUntil ?? ''}
              onChange={(e) => patch({ warrantyUntil: e.target.value || null })}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Location">
          <input
            value={asset.location ?? ''}
            onChange={(e) => patch({ location: e.target.value || null })}
            placeholder="Bengaluru studio"
            className={inputClass}
          />
        </Field>
      </Group>

      {/* Assigning and actually handing over are different events, and the gap
          between them is where kit goes missing. */}
      <Group title="Handover">
      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-[8px] border border-line bg-bg/50 p-3">
        <input
          type="checkbox"
          checked={asset.received}
          onChange={(e) =>
            patch({
              received: e.target.checked,
              receivedOn: e.target.checked ? new Date().toISOString().slice(0, 10) : null,
            })
          }
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
        />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink">Received by the owner</span>
          <span className="block text-[11.5px] leading-relaxed text-ink-3">
            {asset.received && asset.receivedOn
              ? `Handed over on ${asset.receivedOn}.`
              : 'Leave unticked while it is ordered, in transit, or still on the shelf.'}
          </span>
        </span>
      </label>
      </Group>

      <AssetQrPreview fields={fields} />
    </>
  );
}

/**
 * Live preview of the label's QR, last in the form so it reflects everything
 * above it. The payload is regenerated on every keystroke, which is the point:
 * what you see here is exactly what gets printed and scanned.
 */
function AssetQrPreview({ fields }: { fields: ItemFields }) {
  const [printing, setPrinting] = useState(false);

  const item = useMemo(
    () => ({ ...fields, id: 'preview', createdAt: '', updatedAt: '' }),
    [fields],
  );
  const payload = useMemo(() => assetQrPayload(item), [item]);

  const lineCount = payload.split('\n').length - 1;
  // Below this the label is mostly blank and worth filling in first.
  const ready = !!fields.asset?.tag && fields.title.trim().length > 0 && lineCount >= 4;

  return (
    <Group title="QR code" hint="This is what goes on the device">
      <div className="flex flex-col gap-4 rounded-[8px] border border-line bg-bg/50 p-3.5 sm:flex-row sm:items-start">
        {/* White in both themes, so the code stays scannable. */}
        <div className="shrink-0 rounded-[6px] border border-line bg-white p-2">
          <QrCode value={payload} className="h-[112px] w-[112px]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-ink">
            Carries {lineCount} {lineCount === 1 ? 'field' : 'fields'} from this form.
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
            Any phone camera reads it as plain text, so the details survive even for someone with
            no access to the vault. Nothing secret is included: a label rides on the outside of a
            device that leaves the building.
          </p>

          <button
            type="button"
            onClick={() => setPrinting(true)}
            disabled={!ready}
            className="mt-3 flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer size={13} weight="bold" />
            {ready ? 'Print this label' : 'Fill the form to print'}
          </button>

          <details className="mt-2.5">
            <summary className="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink-2">
              What the code says
            </summary>
            <pre className="mt-1.5 max-h-[132px] overflow-auto rounded-[6px] border border-line bg-bg px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink-3">
              {payload}
            </pre>
          </details>
        </div>
      </div>

      {printing && (
        <SingleLabelPrint
          data={{
            tag: fields.asset!.tag!,
            title: fields.title.trim(),
            serial: fields.asset?.serial ?? null,
            assignee: fields.owner?.name ?? null,
            qr: payload,
          }}
          onClose={() => setPrinting(false)}
        />
      )}
    </Group>
  );
}

/**
 * Print one label without leaving the form.
 *
 * Rendered here rather than in a print route because the vault is only
 * decrypted in this tab; a second tab would have no key and print a blank.
 */
function SingleLabelPrint({
  data,
  onClose,
}: {
  data: Parameters<typeof AssetLabel>[0]['data'];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg/95 backdrop-blur-sm print:static print:bg-white">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 print:hidden">
        <p className="flex-1 text-[13px] font-medium text-ink">Label preview</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-[8px] bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110"
        >
          <Printer size={14} weight="bold" />
          Print
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X size={15} weight="bold" />
        </button>
      </div>

      <div className="print-sheet grid flex-1 place-items-center p-8 print:block print:p-0">
        <AssetLabel data={data} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- org ---- */

function OrgFields({ fields, set }: { fields: ItemFields; set: SetField }) {
  const org = fields.org ?? emptyOrg().org!;
  const patch = (next: Partial<NonNullable<ItemFields['org']>>) => set('org', { ...org, ...next });

  // Checked live rather than on submit: a GSTIN is 15 characters of noise and
  // the mistake is far cheaper to catch while it is still on screen.
  const gst = org.gstin ? checkGstin(org.gstin) : null;
  const pan = org.pan ? checkPan(org.pan) : null;
  const cin = org.cin ? checkCin(org.cin) : null;

  return (
    <>
      <Group title="Legal">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registered name" hint="As it appears on the GST certificate">
            <input
              value={org.legalName ?? ''}
              onChange={(e) => patch({ legalName: e.target.value || null })}
              placeholder="Garage Productions Private Limited"
              className={inputClass}
            />
          </Field>
          <Field label="Trading name">
            <input
              value={org.tradeName ?? ''}
              onChange={(e) => patch({ tradeName: e.target.value || null })}
              placeholder="Garage Collective"
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="GSTIN"
          error={gst && !gst.valid ? gst.reason : null}
          hint={gst?.valid ? `${gst.state}, PAN ${gst.pan}` : '15 characters, checksum verified'}
        >
          <input
            value={org.gstin ?? ''}
            onChange={(e) => patch({ gstin: e.target.value.toUpperCase() || null })}
            placeholder="29AAACG1234H1Z5"
            spellCheck={false}
            maxLength={15}
            className={`${inputClass} font-mono uppercase ${
              gst && !gst.valid ? 'border-weak/50' : gst?.valid ? 'border-strong/40' : ''
            }`}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="PAN"
            error={pan && !pan.valid ? pan.reason : null}
            hint={pan?.valid ? pan.holder : undefined}
          >
            <input
              value={org.pan ?? ''}
              onChange={(e) => patch({ pan: e.target.value.toUpperCase() || null })}
              placeholder="AAACG1234H"
              spellCheck={false}
              maxLength={10}
              className={`${inputClass} font-mono uppercase ${
                pan && !pan.valid ? 'border-weak/50' : ''
              }`}
            />
          </Field>
          <Field label="CIN" error={cin && !cin.valid ? cin.reason : null}>
            <input
              value={org.cin ?? ''}
              onChange={(e) => patch({ cin: e.target.value.toUpperCase() || null })}
              placeholder="U72900KA2020PTC123456"
              spellCheck={false}
              maxLength={21}
              className={`${inputClass} font-mono uppercase ${
                cin && !cin.valid ? 'border-weak/50' : ''
              }`}
            />
          </Field>
        </div>

        <Field label="Incorporated on">
          <input
            type="date"
            value={org.incorporatedOn ?? ''}
            onChange={(e) => patch({ incorporatedOn: e.target.value || null })}
            className={inputClass}
          />
        </Field>
      </Group>

      <Group title="Registered address">
        <Field label="Address">
          <textarea
            value={org.registeredAddress ?? ''}
            onChange={(e) => patch({ registeredAddress: e.target.value || null })}
            rows={2}
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City">
            <input
              value={org.city ?? ''}
              onChange={(e) => patch({ city: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="State">
            <input
              value={org.state ?? ''}
              onChange={(e) => patch({ state: e.target.value || null })}
              list="gst-states"
              className={inputClass}
            />
            <datalist id="gst-states">
              {Object.values(GST_STATES).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Pincode">
            <input
              value={org.pincode ?? ''}
              onChange={(e) => patch({ pincode: e.target.value || null })}
              inputMode="numeric"
              maxLength={6}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
      </Group>

      <Group title="Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <input
              type="email"
              value={org.contactEmail ?? ''}
              onChange={(e) => patch({ contactEmail: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={org.contactPhone ?? ''}
              onChange={(e) => patch({ contactPhone: e.target.value || null })}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Website">
          <input
            value={org.website ?? ''}
            onChange={(e) => patch({ website: e.target.value || null })}
            placeholder="https://"
            className={inputClass}
          />
        </Field>
      </Group>
    </>
  );
}

/* -------------------------------------------------------------- person ---- */

function PersonFields({
  fields,
  set,
  people,
}: {
  fields: ItemFields;
  set: SetField;
  people: VaultItem[];
}) {
  const person = fields.person ?? emptyPerson('GC-EMP-0001').person!;
  const patch = (next: Partial<NonNullable<ItemFields['person']>>) =>
    set('person', { ...person, ...next });

  const leads = people.filter((p) => p.id !== fields.title && p.person?.active);

  return (
    <>
      <Group title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <input
              value={person.fullName ?? ''}
              onChange={(e) => {
                patch({ fullName: e.target.value || null });
                // The entry title is the person, so keep them in step.
                set('title', e.target.value);
              }}
              placeholder="Shreyash Tripathi"
              className={inputClass}
            />
          </Field>
          <Field label="Employee ID" hint="Generated, unique across the vault">
            <input
              value={person.employeeId ?? ''}
              onChange={(e) => patch({ employeeId: e.target.value || null })}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work email">
            <input
              type="email"
              value={person.workEmail ?? ''}
              onChange={(e) => {
                patch({ workEmail: e.target.value || null });
                set('owner', { name: person.fullName, email: e.target.value || null });
              }}
              placeholder="name@garageaistack.com"
              className={inputClass}
            />
          </Field>
          <Field label="Personal email">
            <input
              type="email"
              value={person.personalEmail ?? ''}
              onChange={(e) => patch({ personalEmail: e.target.value || null })}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Phone">
          <input
            value={person.phone ?? ''}
            onChange={(e) => patch({ phone: e.target.value || null })}
            className={inputClass}
          />
        </Field>
      </Group>

      <Group title="Role">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <input
              value={person.department ?? ''}
              onChange={(e) => patch({ department: e.target.value || null })}
              list="departments"
              className={inputClass}
            />
            <datalist id="departments">
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Designation">
            <input
              value={person.designation ?? ''}
              onChange={(e) => patch({ designation: e.target.value || null })}
              placeholder="Senior Engineer"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reports to" hint="Their team lead">
            <input
              value={person.reportsTo ?? ''}
              onChange={(e) => patch({ reportsTo: e.target.value || null })}
              list="team-leads"
              placeholder="Name or work email"
              className={inputClass}
            />
            <datalist id="team-leads">
              {leads.map((p) => (
                <option key={p.id} value={p.person?.workEmail ?? p.person?.fullName ?? ''} />
              ))}
            </datalist>
          </Field>
          <Field label="Employment type">
            <select
              value={person.employmentType ?? 'Full time'}
              onChange={(e) => patch({ employmentType: e.target.value })}
              className={inputClass}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-[8px] border border-line bg-bg/50 p-3">
          <input
            type="checkbox"
            checked={person.isTeamLead}
            onChange={(e) => patch({ isTeamLead: e.target.checked })}
            className="h-4 w-4 shrink-0 accent-accent"
          />
          <span className="text-[13px] text-ink">Leads a team</span>
        </label>
      </Group>

      <Group title="Tenure">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Joined on">
            <input
              type="date"
              value={person.joinedOn ?? ''}
              onChange={(e) => patch({ joinedOn: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="Last working day" hint="Leave blank while they are still here">
            <input
              type="date"
              value={person.exitedOn ?? ''}
              onChange={(e) =>
                patch({ exitedOn: e.target.value || null, active: !e.target.value })
              }
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Location">
          <input
            value={person.location ?? ''}
            onChange={(e) => patch({ location: e.target.value || null })}
            placeholder="Bengaluru"
            className={inputClass}
          />
        </Field>

        {!person.active && (
          <p className="mb-4 rounded-[8px] border border-fair/25 bg-fair/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
            Marked as left. Check <span className="text-ink">Who has what</span> for anything
            still filed against them before closing this out.
          </p>
        )}
      </Group>
    </>
  );
}

/* --------------------------------------------------------------- scan ---- */

/** Drop zone that runs OCR locally and hands the guesses back to the form. */
function Scanner({
  hint,
  onRead,
}: {
  hint: string;
  onRead: (result: Awaited<ReturnType<typeof scanDocument>>) => void;
}) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ confidence: number; source: string } | null>(null);

  async function run(file: File) {
    setError(null);
    setOutcome(null);
    setProgress({ stage: 'starting', ratio: 0 });
    try {
      const result = await scanDocument(file, setProgress);
      setOutcome({ confidence: result.confidence, source: result.source });
      onRead(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setProgress(null);
    }
  }

  const summary = outcome
    ? outcome.source === 'pdf-text'
      ? 'Read straight from the PDF text, so the values are exact.'
      : `Recognised at ${Math.round(outcome.confidence)}% confidence. Check the fields below.`
    : null;

  return (
    <div className="mb-5">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) run(file);
        }}
        className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-dashed border-line px-3.5 py-3 transition hover:border-line-strong"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-line bg-raised text-ink-3">
          {progress ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-line-strong border-t-accent" />
          ) : (
            <Camera size={15} weight="bold" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-ink">
            {progress ? `Reading, ${progress.stage}` : 'Scan an invoice'}
          </span>
          <span
            className={`block text-[11px] leading-relaxed ${error ? 'text-weak' : 'text-ink-3'}`}
          >
            {progress
              ? `${Math.round(progress.ratio * 100)}%`
              : (error ?? summary ?? hint)}
          </span>
        </span>
        <input
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run(file);
          }}
        />
      </label>
      <p className="mt-1.5 text-[11px] text-ink-3">
        Runs in this tab. A PDF with real text is read directly; only scans and photos go through
        OCR. Nothing is uploaded.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- pieces ---- */

const inputClass =
  'w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60';

/**
 * Choose the owner from the employee list.
 *
 * Allocation matching keys on the owner's email, so a hand-typed address that
 * differs by a character silently detaches an entry from its person. Picking
 * from the roster makes that impossible. Free text stays available for people
 * who are not employees, such as an agency contact.
 */
function OwnerPicker({
  value,
  people,
  emailValid,
  onChange,
}: {
  value: { name: string | null; email: string | null };
  people: VaultItem[];
  emailValid: boolean;
  onChange: (owner: { name: string | null; email: string | null }) => void;
}) {
  const roster = useMemo(
    () =>
      people
        .filter((p) => p.person?.active !== false)
        .map((p) => ({
          id: p.id,
          name: p.person?.fullName ?? p.title,
          email: p.person?.workEmail ?? p.owner?.email ?? null,
          department: p.person?.department ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const matched = roster.find((r) =>
    value.email
      ? r.email?.toLowerCase() === value.email.toLowerCase()
      : !!value.name && r.name.toLowerCase() === value.name.toLowerCase(),
  );

  // Someone recorded who is not on the roster keeps the free-text form open.
  const [manual, setManual] = useState(
    roster.length === 0 || (!!(value.name || value.email) && !matched),
  );

  if (roster.length > 0 && !manual) {
    return (
      <>
        <Field label="Person" hint="From the employee list, so allocations stay linked">
          <select
            value={matched?.id ?? ''}
            onChange={(e) => {
              if (e.target.value === '__manual') {
                onChange({ name: null, email: null });
                setManual(true);
                return;
              }
              const picked = roster.find((r) => r.id === e.target.value);
              onChange(picked ? { name: picked.name, email: picked.email } : { name: null, email: null });
            }}
            className={inputClass}
          >
            <option value="">Nobody yet</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.department ? ` — ${r.department}` : ''}
              </option>
            ))}
            <option value="__manual">Someone not on the list…</option>
          </select>
        </Field>

        {matched?.email && (
          <p className="-mt-2 mb-4 font-mono text-[11px] text-ink-3">{matched.email}</p>
        )}
        {matched && !matched.email && (
          <p className="-mt-2 mb-4 text-[11px] text-fair">
            No work email on their record, so allocation matches on name alone.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={value.name ?? ''}
            onChange={(e) => onChange({ ...value, name: e.target.value || null })}
            placeholder="Ammar"
            className={inputClass}
          />
        </Field>
        <Field label="Email" error={emailValid ? null : 'Not a valid email address'}>
          <input
            type="email"
            value={value.email ?? ''}
            onChange={(e) => onChange({ ...value, email: e.target.value || null })}
            placeholder="name@garageaistack.com"
            className={inputClass}
          />
        </Field>
      </div>

      {roster.length > 0 && (
        <button
          type="button"
          onClick={() => {
            onChange({ name: null, email: null });
            setManual(false);
          }}
          className="-mt-2 mb-4 text-[11.5px] text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-ink"
        >
          Pick from the employee list instead
        </button>
      )}
    </>
  );
}

/**
 * Pick an existing project or type a new one. A plain text input invites typos
 * that silently split a project in two; a plain select cannot create. This does
 * both, defaulting to the select once any project exists.
 */
function ProjectPicker({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  const known = value != null && options.includes(value);
  const [typing, setTyping] = useState(options.length === 0 || (value != null && !known));

  if (typing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus={options.length > 0}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="Copyloop"
          className={inputClass}
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setTyping(false);
            }}
            className="shrink-0 rounded-[8px] border border-line px-2.5 py-2 text-[12px] text-ink-3 transition hover:border-line-strong hover:text-ink"
          >
            Pick
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__new') {
          onChange(null);
          setTyping(true);
        } else {
          onChange(e.target.value || null);
        }
      }}
      className={inputClass}
    >
      <option value="">None</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
      <option value="__new">New project…</option>
    </select>
  );
}

/**
 * A titled block of related fields. The asset form in particular has fifteen
 * inputs, and a flat list of fifteen is a wall rather than a form.
 */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3.5 flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {hint && <p className="truncate text-[11px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-1 text-accent">*</span>}
      </label>
      <div id={id}>{children}</div>
      {error ? (
        <p className="mt-1.5 text-[11.5px] text-weak">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11.5px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

/** Wrapper that mounts and unmounts the editor with a transition. */
export function ItemEditorHost({
  open,
  item,
  initialKind,
  lockKind,
  identity,
  projects,
  onProjectCreated,
  onClose,
}: {
  open: boolean;
  item: VaultItem | null;
  initialKind: ItemKind;
  lockKind: boolean;
  identity: Identity | null;
  projects: string[];
  onProjectCreated: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <ItemEditor
          key="editor"
          item={item}
          initialKind={initialKind}
          lockKind={lockKind}
          identity={identity}
          projects={projects}
          onProjectCreated={onProjectCreated}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  );
}
