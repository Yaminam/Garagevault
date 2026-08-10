'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle,
  Copy,
  DownloadSimple,
  Eye,
  EyeSlash,
  FileArrowUp,
  FilePdf,
  Key,
  LinkSimple,
  Package,
  PencilSimple,
  Printer,
  ShieldWarning,
  Trash,
  UserCircle,
  WarningCircle,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { VERDICT_LABEL, scorePassword } from '@/lib/audit.ts';
import { toEnvBlock } from '@/lib/env-templates.ts';
import { ASSET_CATEGORY_LABEL, withGb } from '@/lib/assets.ts';
import { assetQrUrl, currentOrigin } from '@/lib/qr.ts';
import { checkGstin } from '@/lib/org.ts';
import {
  ASSET_STATUS_LABEL,
  BILLING_CYCLE_LABEL,
  type ItemFields,
  type VaultItem,
} from '@/lib/types.ts';
import { formatBytes } from '@/lib/attachments.ts';
import { useVault } from './vault-context.tsx';
import { AssetLabel, QrCode } from './BarcodeLabel.tsx';
import { brandMarkForItem } from '@/lib/brand-marks.ts';
import { BrandTile, EmptyState, Monogram, Pill, StrengthMeter, useToast } from './primitives.tsx';
import { ShareDialogHost, type SharePayload } from './ShareDialog.tsx';

/** A revealed secret hides itself again after this long. */
const REVEAL_TTL_MS = 20_000;

type Props = {
  item: VaultItem | null;
  onBack: () => void;
  onEdit: (item: VaultItem) => void;
};

export function ItemDetail({ item, onBack, onEdit }: Props) {
  const reduce = useReducedMotion();

  if (!item) {
    return (
      <EmptyState
        icon={<Key size={20} weight="bold" />}
        title="No entry selected"
        hint="Pick one from the list, press Ctrl K to search, or Ctrl N to add."
      />
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={item.id}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="h-full overflow-y-auto"
      >
        <Detail item={item} onBack={onBack} onEdit={onEdit} />
      </motion.div>
    </AnimatePresence>
  );
}

function Detail({ item, onBack, onEdit }: { item: VaultItem; onBack: () => void; onEdit: (i: VaultItem) => void }) {
  const { copy, removeItem } = useVault();
  const [sharing, setSharing] = useState<SharePayload | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const score = item.password ? scorePassword(item.password) : null;
  const isEnv = item.kind === 'env';

  const sharePayload = (): SharePayload =>
    isEnv
      ? {
          title: item.title,
          entries: item.vars.map((v) => ({ label: v.key, value: v.value, secret: v.secret })),
          note: item.notes,
        }
      : {
          title: item.title,
          entries: [
            item.url ? { label: 'URL', value: item.url, secret: false } : null,
            item.username ? { label: 'Username', value: item.username, secret: false } : null,
            item.password ? { label: 'Password', value: item.password, secret: true } : null,
          ].filter((e): e is { label: string; value: string; secret: boolean } => e !== null),
          note: item.notes,
        };

  return (
    <div className="mx-auto max-w-[780px] px-5 py-5 md:px-8 md:py-7">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink md:hidden"
      >
        <ArrowLeft size={14} weight="bold" />
        Back to list
      </button>

      {/* Header. Same mark the list row showed, so opening an entry confirms
          you landed on the one you clicked. */}
      <div className="flex items-start gap-4">
        {(() => {
          const mark = brandMarkForItem(item);
          return mark ? (
            <BrandTile mark={mark} size="lg" />
          ) : (
            <Monogram label={item.title} size="lg" />
          );
        })()}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[21px] font-semibold tracking-[-0.015em] text-ink">
            {item.title}
          </h1>
          <p className="mt-1 truncate text-[13px] text-ink-2">{headlineFor(item)}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {item.project && <Pill tone="accent">{item.project}</Pill>}
            <Pill>{item.entity}</Pill>
            {item.kind === 'asset' && (
              <Pill tone={item.asset?.received ? 'good' : 'warn'}>
                {item.asset?.received ? 'Received' : 'Not received'}
              </Pill>
            )}
            {item.kind === 'login' && item.accountType && <Pill>{item.accountType}</Pill>}
            {score && (
              <Pill tone={score.verdict === 'strong' ? 'good' : 'warn'}>
                {VERDICT_LABEL[score.verdict]} password
              </Pill>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Action onClick={() => onEdit(item)} icon={<PencilSimple size={13} weight="bold" />}>
          Edit
        </Action>
        <Action onClick={() => setSharing(sharePayload())} icon={<LinkSimple size={13} weight="bold" />}>
          Share securely
        </Action>
        {isEnv && item.vars.length > 0 && (
          <Action
            onClick={() => copy(toEnvBlock(item.vars), '.env block')}
            icon={<DownloadSimple size={13} weight="bold" />}
          >
            Copy as .env
          </Action>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 rounded-[8px] border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink active:translate-y-px"
          >
            Open
            <ArrowSquareOut size={13} weight="bold" />
          </a>
        )}
        <div className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-[12px] text-ink-3">Delete for good?</span>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="rounded-[8px] border border-weak/40 bg-weak/10 px-3 py-1.5 text-[12.5px] font-medium text-weak transition hover:bg-weak/15"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-[12.5px] text-ink-3 hover:text-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <Action onClick={() => setConfirmingDelete(true)} icon={<Trash size={13} weight="bold" />}>
              Delete
            </Action>
          )}
        </div>
      </div>

      {/* Owner. A secret with no named owner has nobody to rotate it. */}
      <div className="mt-5 flex items-center gap-3 rounded-[12px] border border-line bg-panel px-4 py-3">
        <UserCircle size={18} weight="bold" className="shrink-0 text-ink-3" />
        {item.owner?.name || item.owner?.email ? (
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink">{item.owner.name ?? 'Unnamed'}</p>
            {item.owner.email && (
              <p className="truncate text-[11.5px] text-ink-3">{item.owner.email}</p>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-3">
            Nobody recorded as the owner. Add one so this can be rotated when someone leaves.
          </p>
        )}
      </div>

      {/* Warnings carried over from the spreadsheet */}
      {item.flags.includes('password-unknown') && (
        <Banner
          title="Password never recorded"
          body="The spreadsheet marks this row as not provided. Confirm the real value with whoever owns the account, then edit this entry."
        />
      )}
      {item.alternates.length > 0 && (
        <Banner
          title="Conflicting passwords in the notes"
          body={`Another candidate appears in the notes: ${item.alternates.join(', ')}. Verify which one is current.`}
        />
      )}

      {/* Fields */}
      {item.kind === 'env' && <EnvTable item={item} />}
      {item.kind === 'billing' && <BillingTable item={item} />}
      {item.kind === 'asset' && <AssetPanel item={item} />}
      {item.kind === 'org' && <OrgTable item={item} />}
      {item.kind === 'person' && <PersonPanel item={item} />}
      {item.kind === 'login' && (
        <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
          {item.url && <LinkRow label="Login URL" value={item.url} onCopy={() => copy(item.url!, 'URL')} />}
          {item.username && (
            <TextRow label="Username" value={item.username} onCopy={() => copy(item.username!, 'Username')} />
          )}
          <SecretRow
            label="Password"
            value={item.password}
            onCopy={() => item.password && copy(item.password, 'Password')}
          />
          <TextRow label="Two-factor" value={item.twofa ?? 'Not recorded'} muted={!item.twofa} />
          {item.twofaContact && (
            <TextRow
              label="2FA contact"
              value={item.twofaContact}
              onCopy={() => copy(item.twofaContact!, '2FA contact')}
            />
          )}
        </div>
      )}

      {/* Strength */}
      {score && (
        <section className="mt-5 rounded-[12px] border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="label-caps">Strength</p>
              <p className="mt-1.5 text-[15px] font-medium text-ink">
                {VERDICT_LABEL[score.verdict]}
                <span className="ml-2 font-mono text-[12px] font-normal text-ink-3">
                  {score.entropyBits} bits
                </span>
              </p>
            </div>
            <StrengthMeter verdict={score.verdict} percent={score.percent} />
          </div>

          {score.reasons.length > 0 && (
            <ul className="mt-3.5 space-y-1.5 border-t border-line pt-3.5">
              {score.reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
                  <ShieldWarning size={13} weight="bold" className="mt-[3px] shrink-0 text-fair" />
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {item.notes && (
        <section className="mt-5">
          <p className="label-caps">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{item.notes}</p>
        </section>
      )}

      <p className="mt-8 border-t border-line pt-4 font-mono text-[11px] text-ink-3">
        {item.section.toLowerCase()}, updated{' '}
        {new Date(item.updatedAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>

      <ShareDialogHost payload={sharing} onClose={() => setSharing(null)} />
    </div>
  );
}

/* ----------------------------------------------------------------- env ---- */

function EnvTable({ item }: { item: VaultItem }) {
  const { copy } = useVault();

  if (item.vars.length === 0) {
    return (
      <p className="mt-5 rounded-[12px] border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-3">
        No variables yet. Edit this entry to add some.
      </p>
    );
  }

  return (
    <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
      {item.vars.map((variable) => (
        <EnvRow
          key={variable.key}
          name={variable.key}
          value={variable.value}
          secret={variable.secret}
          onCopy={() => copy(variable.value, variable.key)}
        />
      ))}
    </div>
  );
}

function EnvRow({
  name,
  value,
  secret,
  onCopy,
}: {
  name: string;
  value: string;
  secret: boolean;
  onCopy: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(false), REVEAL_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  const shown = !secret || revealed;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5 last:border-b-0">
      <span className="w-[46%] shrink-0 truncate font-mono text-[12px] font-medium text-ink">
        {name}
      </span>
      <span
        className={`min-w-0 flex-1 truncate font-secret text-[12.5px] ${shown ? 'text-ink-2' : 'text-ink-3'}`}
      >
        {shown ? value || 'empty' : '•'.repeat(Math.min(value.length || 8, 20))}
      </span>
      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? `Hide ${name}` : `Reveal ${name}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink"
        >
          {revealed ? <EyeSlash size={13} weight="bold" /> : <Eye size={13} weight="bold" />}
        </button>
      )}
      <CopyButton onCopy={onCopy} label={name} />
    </div>
  );
}

/** The one line under the title, per kind. */
function headlineFor(item: VaultItem): string {
  switch (item.kind) {
    case 'env':
      return `${item.vars.length} ${item.vars.length === 1 ? 'variable' : 'variables'}`;
    case 'billing':
      return item.billing?.vendor ?? 'No vendor recorded';
    case 'asset':
      return [item.asset?.make, item.asset?.model].filter(Boolean).join(' ') || 'No device recorded';
    case 'org':
      return item.org?.legalName ?? 'No registered name';
    case 'person':
      return (
        [item.person?.designation, item.person?.department].filter(Boolean).join(' · ') ||
        (item.person?.workEmail ?? 'No role recorded')
      );
    default:
      return item.username ?? 'No login recorded';
  }
}

/* ------------------------------------------------------------------ org ---- */

function OrgTable({ item }: { item: VaultItem }) {
  const { copy } = useVault();
  const org = item.org;
  if (!org) return null;

  const gst = org.gstin ? checkGstin(org.gstin) : null;

  const address = [org.registeredAddress, org.city, org.state, org.pincode, org.country]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      {gst && (
        <section
          className={`mt-5 flex items-start gap-3 rounded-[12px] border p-3.5 ${
            gst.valid ? 'border-strong/25 bg-strong/[0.06]' : 'border-weak/25 bg-weak/[0.06]'
          }`}
        >
          {gst.valid ? (
            <CheckCircle size={17} weight="bold" className="mt-px shrink-0 text-strong" />
          ) : (
            <WarningCircle size={17} weight="bold" className="mt-px shrink-0 text-weak" />
          )}
          <div className="min-w-0">
            <p className="font-mono text-[14px] font-medium text-ink">{org.gstin}</p>
            <p className="mt-0.5 text-[12px] text-ink-2">
              {gst.valid
                ? `Checksum verified. Registered in ${gst.state}.`
                : gst.reason}
            </p>
          </div>
        </section>
      )}

      <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
        {org.legalName && <TextRow label="Registered" value={org.legalName} />}
        {org.tradeName && <TextRow label="Trading as" value={org.tradeName} />}
        {org.gstin && (
          <TextRow label="GSTIN" value={org.gstin} onCopy={() => copy(org.gstin!, 'GSTIN')} />
        )}
        {org.pan && <TextRow label="PAN" value={org.pan} onCopy={() => copy(org.pan!, 'PAN')} />}
        {org.cin && <TextRow label="CIN" value={org.cin} onCopy={() => copy(org.cin!, 'CIN')} />}
        {org.incorporatedOn && <TextRow label="Incorporated" value={org.incorporatedOn} />}
        {address && <TextRow label="Address" value={address} onCopy={() => copy(address, 'Address')} />}
        {org.contactEmail && (
          <TextRow
            label="Email"
            value={org.contactEmail}
            onCopy={() => copy(org.contactEmail!, 'Email')}
          />
        )}
        {org.contactPhone && <TextRow label="Phone" value={org.contactPhone} />}
        {org.website && <LinkRow label="Website" value={org.website} onCopy={() => copy(org.website!, 'Website')} />}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- person ---- */

function PersonPanel({ item }: { item: VaultItem }) {
  const { copy, items } = useVault();
  const person = item.person;
  if (!person) return null;

  // What this person holds, which is the question worth answering on their page.
  const key = (person.workEmail ?? person.fullName ?? '').toLowerCase();
  const allocated = items.filter((other) => {
    if (other.id === item.id || other.kind === 'person' || other.kind === 'org') return false;
    const owner = (other.owner?.email ?? other.owner?.name ?? '').toLowerCase();
    return !!key && owner === key;
  });

  return (
    <>
      {!person.active && (
        <Banner
          title="No longer with the company"
          body={`Last working day ${person.exitedOn ?? 'not recorded'}. Anything still listed below needs rotating or collecting.`}
        />
      )}

      <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
        {person.employeeId && <TextRow label="Employee ID" value={person.employeeId} />}
        {person.designation && <TextRow label="Designation" value={person.designation} />}
        {person.department && <TextRow label="Department" value={person.department} />}
        {person.reportsTo && <TextRow label="Reports to" value={person.reportsTo} />}
        {person.workEmail && (
          <TextRow
            label="Work email"
            value={person.workEmail}
            onCopy={() => copy(person.workEmail!, 'Work email')}
          />
        )}
        {person.personalEmail && <TextRow label="Personal email" value={person.personalEmail} />}
        {person.phone && (
          <TextRow label="Phone" value={person.phone} onCopy={() => copy(person.phone!, 'Phone')} />
        )}
        {person.employmentType && <TextRow label="Employment" value={person.employmentType} />}
        {person.joinedOn && <TextRow label="Joined" value={person.joinedOn} />}
        {person.location && <TextRow label="Location" value={person.location} />}
      </div>

      <section className="mt-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">Allocated to them</h2>
          <p className="text-[12px] text-ink-3">
            {allocated.length} {allocated.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>

        {allocated.length === 0 ? (
          <p className="mt-3 rounded-[12px] border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-3">
            Nothing filed against them yet.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-[12px] border border-line bg-panel">
            {allocated.map((other) => (
              <div
                key={other.id}
                className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{other.title}</span>
                {other.kind === 'asset' && other.asset?.tag && (
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">
                    {other.asset.tag}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-ink-3">{other.kind}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------- billing ---- */

function BillingTable({ item }: { item: VaultItem }) {
  const { copy } = useVault();
  const billing = item.billing;
  if (!billing) return null;

  const renewal = billing.nextRenewal ? new Date(billing.nextRenewal) : null;
  const daysAway = renewal
    ? Math.ceil((renewal.getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <>
      {/* The number is the point, so it gets the space. */}
      <section className="mt-5 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-[minmax(0,200px)_1fr]">
        <div className="bg-panel p-4">
          <p className="label-caps">Amount</p>
          <p className="mt-1.5 font-mono text-[26px] font-medium leading-none tracking-tight text-ink">
            {billing.amount != null
              ? `${billing.currency} ${billing.amount.toLocaleString()}`
              : 'Not set'}
          </p>
          <p className="mt-2 text-[11.5px] text-ink-3">
            {BILLING_CYCLE_LABEL[billing.cycle]}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px bg-line">
          <div className="bg-panel px-4 py-3">
            <p className="label-caps">Next renewal</p>
            <p className="mt-1 text-[13px] text-ink">
              {billing.nextRenewal ?? 'Not set'}
            </p>
            {daysAway != null && (
              <p className={`mt-0.5 text-[11px] ${daysAway <= 7 ? 'text-fair' : 'text-ink-3'}`}>
                {daysAway < 0 ? `${-daysAway} days ago` : `in ${daysAway} days`}
              </p>
            )}
          </div>
          <div className="bg-panel px-4 py-3">
            <p className="label-caps">Paid on</p>
            <p className="mt-1 text-[13px] text-ink">{billing.paidOn ?? 'Not recorded'}</p>
          </div>
        </div>
      </section>

      <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
        <TextRow label="Vendor" value={billing.vendor ?? 'Not set'} muted={!billing.vendor} />
        {billing.plan && <TextRow label="Plan" value={billing.plan} />}
        {billing.invoiceNumber && (
          <TextRow
            label="Invoice"
            value={billing.invoiceNumber}
            onCopy={() => copy(billing.invoiceNumber!, 'Invoice number')}
          />
        )}
        {billing.billingEmail && (
          <TextRow
            label="Billed to"
            value={billing.billingEmail}
            onCopy={() => copy(billing.billingEmail!, 'Billing email')}
          />
        )}
      </div>

      {billing.scannedAt && (
        <p className="mt-2.5 text-[11.5px] text-ink-3">
          Read from a scanned document. Worth checking against the original.
        </p>
      )}

      <InvoiceFile item={item} />
    </>
  );
}

/* ---------------------------------------------------------- invoice file ---- */

/**
 * The invoice itself, if one is attached.
 *
 * Opening it is a download plus a decrypt, because the stored object is
 * ciphertext and nothing upstream can render it. The decrypted bytes only ever
 * exist as a blob URL in this tab, and that URL is revoked as soon as the
 * browser has taken it, so a decrypted invoice is not left addressable.
 */
function InvoiceFile({ item }: { item: VaultItem }) {
  const { attachFile, readAttachment, dropAttachment, saveItem } = useVault();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'open' | 'upload' | 'remove'>(null);

  const file = item.billing?.file ?? null;

  const fields = (): ItemFields => ({
    ...item,
    billing: item.billing ? { ...item.billing } : null,
  });

  async function open() {
    if (!file) return;
    setBusy('open');
    try {
      const blob = await readAttachment(file);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // The tab has the bytes by now; keeping the URL alive only keeps a
      // decrypted copy reachable from this document.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not open the file', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function attach(picked: File) {
    setBusy('upload');
    try {
      const ref = await attachFile(picked);
      const next = fields();
      next.billing!.file = ref;
      await saveItem(item.id, next);
      toast.push('Invoice attached');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not attach the file', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!file) return;
    setBusy('remove');
    try {
      // Storage first: a pointer with no object is a broken link, but an
      // object with no pointer is invisible and bills for space forever.
      await dropAttachment(file);
      const next = fields();
      next.billing!.file = null;
      await saveItem(item.id, next);
      toast.push('Invoice removed');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not remove the file', 'warn');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="label-caps mb-2.5">Invoice</p>

      {file ? (
        <div className="flex items-center gap-3 rounded-[8px] border border-line bg-raised/60 px-3 py-2.5">
          <FilePdf size={18} weight="duotone" className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink">{file.name}</span>
            <span className="block text-[11px] text-ink-3">
              {formatBytes(file.size)}, encrypted
            </span>
          </span>
          <button
            type="button"
            onClick={open}
            disabled={busy !== null}
            className="shrink-0 rounded-[6px] border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            {busy === 'open' ? 'Opening' : 'Open'}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            aria-label="Remove the invoice"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-weak disabled:opacity-40"
          >
            <Trash size={13} weight="bold" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3 transition hover:border-accent/50 hover:text-ink-2 disabled:opacity-40"
        >
          <FileArrowUp size={14} weight="bold" />
          {busy === 'upload' ? 'Encrypting and uploading' : 'Attach the invoice'}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) void attach(picked);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- asset ---- */

function AssetPanel({ item }: { item: VaultItem }) {
  const { copy, saveItem } = useVault();
  const [printing, setPrinting] = useState(false);
  const [saving, setSaving] = useState(false);

  const asset = item.asset;
  if (!asset) return null;

  const payload = assetQrUrl(item, currentOrigin());

  async function markReceived(received: boolean) {
    setSaving(true);
    try {
      const { id, createdAt, updatedAt, ...fields } = item;
      void id;
      void createdAt;
      void updatedAt;
      await saveItem(item.id, {
        ...fields,
        asset: {
          ...asset!,
          received,
          receivedOn: received ? new Date().toISOString().slice(0, 10) : null,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Tag and code together: this pair is the label. */}
      <section className="mt-5 flex flex-col gap-4 rounded-[12px] border border-line bg-panel p-4 sm:flex-row sm:items-center">
        {/* Always white, whatever the theme: a QR code needs its quiet zone to
            be the light half of the contrast pair or scanners miss it. */}
        <div className="shrink-0 rounded-[8px] border border-line bg-white p-2">
          <QrCode value={payload} className="h-[104px] w-[104px]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="label-caps">Asset tag</p>
          <p className="mt-1 font-mono text-[20px] font-medium tracking-tight text-ink">
            {asset.tag ?? 'None'}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
            Scan with any phone camera to read the details as plain text.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPrinting(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              <Printer size={13} weight="bold" />
              Print label
            </button>
            {asset.tag && (
              <button
                type="button"
                onClick={() => copy(asset.tag!, 'Asset tag')}
                className="flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink"
              >
                <Copy size={13} weight="bold" />
                Copy tag
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Handover, actionable from here since it is the thing that changes most. */}
      <section
        className={`mt-5 flex items-center gap-3 rounded-[12px] border p-3.5 ${
          asset.received ? 'border-strong/25 bg-strong/[0.06]' : 'border-fair/25 bg-fair/[0.06]'
        }`}
      >
        {asset.received ? (
          <CheckCircle size={17} weight="bold" className="shrink-0 text-strong" />
        ) : (
          <Package size={17} weight="bold" className="shrink-0 text-fair" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            {asset.received ? 'Received by the owner' : 'Not yet received'}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            {asset.received && asset.receivedOn
              ? `Handed over on ${asset.receivedOn}.`
              : 'Ordered, in transit, or still on the shelf.'}
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => markReceived(!asset.received)}
          className="shrink-0 rounded-[8px] border border-line bg-panel px-3 py-1.5 text-[12px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          {saving ? 'Saving' : asset.received ? 'Mark not received' : 'Mark received'}
        </button>
      </section>

      <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
        <TextRow label="Status" value={ASSET_STATUS_LABEL[asset.status]} />
        {asset.make || asset.model ? (
          <TextRow label="Device" value={[asset.make, asset.model].filter(Boolean).join(' ')} />
        ) : null}
        {asset.serial && (
          <TextRow
            label="Serial"
            value={asset.serial}
            onCopy={() => copy(asset.serial!, 'Serial number')}
          />
        )}
        {asset.category && (
          <TextRow label="Category" value={ASSET_CATEGORY_LABEL[asset.category] ?? asset.category} />
        )}
        {asset.specs?.cpu && <TextRow label="CPU" value={asset.specs.cpu} />}
        {asset.specs?.ram && <TextRow label="RAM" value={withGb(asset.specs.ram)!} />}
        {asset.specs?.storage && <TextRow label="Storage" value={withGb(asset.specs.storage)!} />}
        {asset.specs?.gpu && <TextRow label="GPU" value={asset.specs.gpu} />}
        {asset.location && <TextRow label="Location" value={asset.location} />}
        {asset.purchasedOn && <TextRow label="Purchased" value={asset.purchasedOn} />}
        {(asset.warrantyStart || asset.warrantyUntil) && (
          <TextRow
            label="Warranty"
            value={
              asset.warrantyStart && asset.warrantyUntil
                ? `${asset.warrantyStart} – ${asset.warrantyUntil}`
                : (asset.warrantyStart ?? asset.warrantyUntil)!
            }
          />
        )}
        {asset.cost != null && (
          <TextRow label="Cost" value={`${asset.currency} ${asset.cost.toLocaleString()}`} />
        )}
      </div>

      {printing && (
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
              onClick={() => setPrinting(false)}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <X size={15} weight="bold" />
            </button>
          </div>
          <div className="print-sheet grid flex-1 place-items-center p-8 print:block print:p-0">
            <AssetLabel
              data={{
                tag: asset.tag ?? '',
                title: item.title,
                serial: asset.serial,
                assignee: item.owner?.name ?? null,
                qr: payload,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- rows ---- */

function Shell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-3 last:border-b-0">
      <span className="w-[104px] shrink-0 text-[12px] text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function CopyButton({ onCopy, label }: { onCopy: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink active:scale-95"
    >
      <Copy size={14} weight="bold" />
    </button>
  );
}

function TextRow({
  label,
  value,
  onCopy,
  muted = false,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  muted?: boolean;
}) {
  return (
    <Shell label={label}>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${muted ? 'text-ink-3' : 'text-ink'}`}>
        {value}
      </span>
      {onCopy && <CopyButton onCopy={onCopy} label={label.toLowerCase()} />}
    </Shell>
  );
}

function LinkRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <Shell label={label}>
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="min-w-0 flex-1 truncate text-[13px] text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-accent"
      >
        {value}
      </a>
      <CopyButton onCopy={onCopy} label={label.toLowerCase()} />
    </Shell>
  );
}

function SecretRow({ label, value, onCopy }: { label: string; value: string | null; onCopy: () => void }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(false), REVEAL_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  if (!value) {
    return (
      <Shell label={label}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-ink-3">
          <WarningCircle size={14} weight="bold" />
          Not recorded
        </span>
      </Shell>
    );
  }

  return (
    <Shell label={label}>
      <span className="min-w-0 flex-1 truncate font-secret text-[13.5px] text-ink">
        {revealed ? value : '•'.repeat(Math.min(value.length, 24))}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? 'Hide password' : 'Reveal password'}
        title={revealed ? 'Hide' : 'Reveal for 20 seconds'}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition hover:bg-hover hover:text-ink active:scale-95"
      >
        {revealed ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
      </button>
      <CopyButton onCopy={onCopy} label="password" />
    </Shell>
  );
}

function Action({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-[8px] border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink active:translate-y-px"
    >
      {icon}
      {children}
    </button>
  );
}

function Banner({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-5 flex items-start gap-3 rounded-[12px] border border-fair/25 bg-fair/[0.06] p-3.5">
      <WarningCircle size={16} weight="bold" className="mt-px shrink-0 text-fair" />
      <div>
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{body}</p>
      </div>
    </div>
  );
}
