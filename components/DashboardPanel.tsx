'use client';

import { useMemo } from 'react';
import {
  ArrowRight,
  Barcode,
  CaretRight,
  FileArrowUp,
  FileText,
  Key,
  Package,
  Pulse,
  Receipt,
  ShieldWarning,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import { excludeOutliers } from '@/lib/spend.ts';
import { ASSET_CATEGORY_LABEL } from '@/lib/assets.ts';
import type { Identity } from '@/lib/identity.ts';
import { BILLING_CYCLE_LABEL, type ItemKind, type VaultItem } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';
import { Monogram } from './primitives.tsx';
import { SpendChart } from './SpendChart.tsx';

/**
 * The landing view.
 *
 * A glance at the whole vault: what is in it, what it costs, what renews soon,
 * and what needs attention. Every tile and row is a way into the detail, so it
 * is a map rather than a report.
 */

type Jump =
  | { kind: 'all' }
  | { kind: 'logins' }
  | { kind: 'environments' }
  | { kind: 'billing' }
  | { kind: 'assets' }
  | { kind: 'people' }
  | { kind: 'organisation' };

type Props = {
  identity: Identity | null;
  onFilter: (jump: Jump) => void;
  onView: (view: 'health' | 'allocation') => void;
  onOpen: (id: string) => void;
  onNewItem: (kind: ItemKind) => void;
  onUploadInvoice: () => void;
};

/** Group amounts by currency, since a vault mixes USD and INR. */
function sumByCurrency(bills: VaultItem[], predicate: (i: VaultItem) => boolean) {
  const totals = new Map<string, number>();
  for (const bill of bills) {
    if (!predicate(bill)) continue;
    const amount = bill.billing?.amount;
    if (amount == null) continue;
    const ccy = bill.billing?.currency ?? '—';
    totals.set(ccy, (totals.get(ccy) ?? 0) + amount);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

const money = (ccy: string, n: number) => `${ccy} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * A plain-English line for "recently updated", instead of a title next to a
 * bare kind label. What actually happened (assigned to whom, added to the
 * list) is the useful part; the raw record title on its own does not say it.
 */
function describeUpdate(item: VaultItem): string {
  switch (item.kind) {
    case 'asset': {
      const category = item.asset?.category
        ? (ASSET_CATEGORY_LABEL[item.asset.category] ?? item.asset.category)
        : 'Asset';
      return item.owner?.name
        ? `${category} assigned to ${item.owner.name}`
        : `${category} added, not yet assigned`;
    }
    case 'person':
      return `${item.person?.fullName ?? item.title} added to the employee list`;
    case 'billing':
      return `${item.billing?.vendor ?? item.title} bill updated`;
    case 'env':
      return `${item.title} environment file updated`;
    case 'org':
      return `${item.title} company details updated`;
    default:
      return `${item.title} login updated`;
  }
}

export function DashboardPanel({
  identity,
  onFilter,
  onView,
  onOpen,
  onNewItem,
  onUploadInvoice,
}: Props) {
  const { items, audit } = useVault();

  const stats = useMemo(() => {
    const by = (k: VaultItem['kind']) => items.filter((i) => i.kind === k);
    const allBills = by('billing');
    const assets = by('asset');

    // One-off giants are left out of every figure below, for the same reason
    // the charts leave them out: a single capital invoice a hundred times the
    // size of the rest is not what "what do we spend" is asking about. The
    // count is surfaced so the omission is visible rather than assumed.
    const { kept: bills, dropped } = excludeOutliers(allBills);

    // "This month" by the paid date, which is what a monthly close looks at.
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Warranties due out in the next 30 days. Already-expired ones are a
    // separate, older problem and would just sit in this count forever, so
    // this is a heads-up window rather than a running tally of neglect.
    const today = now.toISOString().slice(0, 10);
    const warrantyHorizon = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const warrantyExpiring = assets.filter((a) => {
      const until = a.asset?.warrantyUntil;
      return until && until >= today && until <= warrantyHorizon;
    }).length;
    const thisMonth = sumByCurrency(bills, (b) => (b.billing?.paidOn ?? '').startsWith(ym));

    const recurring = sumByCurrency(
      bills,
      (b) => b.billing?.cycle === 'monthly' || b.billing?.cycle === 'yearly',
    );

    return {
      total: items.length,
      logins: by('login').length,
      envs: by('env').length,
      bills,
      dropped,
      billsCount: allBills.length,
      assets,
      assetsCount: assets.length,
      notReceived: assets.filter((a) => a.asset && !a.asset.received).length,
      warrantyExpiring,
      people: by('person').length,
      orgs: by('org').length,
      thisMonth,
      recurring,
    };
  }, [items]);

  // Bills renewing and warranties running out in the next 30 days, merged
  // into one timeline: both are a countdown to something that needs a
  // decision, and splitting them into two short lists just to say "nothing
  // due" twice told you less than one list would.
  const expiring = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

    const bills = items
      .filter((i) => i.billing?.nextRenewal && i.billing.nextRenewal >= today && i.billing.nextRenewal <= horizon)
      .map((i) => ({ item: i, date: i.billing!.nextRenewal!, renewal: true }));

    const warranties = items
      .filter((i) => i.asset?.warrantyUntil && i.asset.warrantyUntil >= today && i.asset.warrantyUntil <= horizon)
      .map((i) => ({ item: i, date: i.asset!.warrantyUntil!, renewal: false }));

    return [...bills, ...warranties].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 6);
  }, [items]);

  // Most recently touched, as a "where was I" list.
  const recent = useMemo(
    () =>
      [...items]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 6),
    [items],
  );

  const healthTone = audit.health >= 75 ? 'text-strong' : audit.health >= 45 ? 'text-fair' : 'text-weak';
  const healthBar = audit.health >= 75 ? 'bg-strong' : audit.health >= 45 ? 'bg-fair' : 'bg-weak';

  const firstName = identity?.name?.split(' ')[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-5 py-6 md:px-8 md:py-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
          {firstName ? `Welcome back, ${firstName}` : 'Overview'}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {stats.total} entries across the vault. Everything at a glance.
        </p>

        {/* Quick actions: the three things opening the dashboard usually
            means doing something about, one click away instead of a detour
            through the sidebar. */}
        <div className="mt-5 flex flex-wrap gap-2">
          <QuickAction
            icon={<Barcode size={14} weight="bold" />}
            label="Add asset"
            onClick={() => onNewItem('asset')}
          />
          <QuickAction
            icon={<UserPlus size={14} weight="bold" />}
            label="Add person"
            onClick={() => onNewItem('person')}
          />
          <QuickAction
            icon={<FileArrowUp size={14} weight="bold" />}
            label="Upload invoice"
            onClick={onUploadInvoice}
          />
        </div>

        {/*
          One continuous band split by hairlines rather than six bordered
          cards. The counts are the content; a box around each one added a
          rectangle per number and no meaning, and six identical cards in a row
          is the most templated shape a dashboard can open with.
        */}
        <div className="mt-7 grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-5">
          <Tile icon={<Key size={16} weight="bold" />} label="Logins" value={stats.logins} onClick={() => onFilter({ kind: 'logins' })} />
          <Tile icon={<FileText size={16} weight="bold" />} label="Environments" value={stats.envs} onClick={() => onFilter({ kind: 'environments' })} />
          <Tile icon={<Receipt size={16} weight="bold" />} label="Bills" value={stats.billsCount} onClick={() => onFilter({ kind: 'billing' })} />
          <Tile icon={<Barcode size={16} weight="bold" />} label="Assets" value={stats.assetsCount} onClick={() => onFilter({ kind: 'assets' })} />
          <Tile icon={<UsersThree size={16} weight="bold" />} label="People" value={stats.people} onClick={() => onFilter({ kind: 'people' })} />
        </div>

        {/* Two independently-flowing columns, not two side-by-side row-pairs.
            Grid rows are only ever as tall as their tallest cell, so pairing
            "Spend beside Security" and "Expiring soon beside Recently
            updated" as two separate row-groups left Security (reliably
            shorter than Spend's vendor list) stranded with a slab of empty
            grid track before the next row could start — align-items alone
            can't fix that, since the row track itself stays tall regardless
            of whether the shorter item stretches into it. Stacking each
            side's two sections inside its own flex column instead means a
            short right side just ends sooner; the leftover space happens
            once, at the very bottom, the way two columns of unequal length
            are supposed to look. */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10 lg:divide-x lg:divide-line">
          {/* Left: Spend, then Expiring soon */}
          <div className="flex flex-col gap-8 lg:pr-10">
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">Spend</h2>
                <button
                  type="button"
                  onClick={() => onFilter({ kind: 'billing' })}
                  className="flex items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink"
                >
                  All bills <ArrowRight size={11} weight="bold" />
                </button>
              </div>

              {/* The trend, not just the total: nine months of bars says more
                  at a glance than two numbers ever could. */}
              <div className="mt-4">
                <SpendChart items={items} onOpen={() => onFilter({ kind: 'billing' })} />
              </div>

              {/* Was a bordered grid inside a bordered card. Two figures do not
                  need a container each, let alone a container inside a
                  container. Every currency is listed: a rupee total and a dollar
                  total are both true, and adding them would not be. */}
              <div className="mt-4 grid grid-cols-2 gap-6">
                <div>
                  <p className="label-caps">This month</p>
                  {stats.thisMonth.length === 0 ? (
                    <p className="mt-2 text-[13px] text-ink-3">Nothing yet</p>
                  ) : (
                    stats.thisMonth.map(([ccy, n]) => (
                      <p key={ccy} className="mt-1.5 font-mono text-[15px] font-medium text-ink">
                        {money(ccy, n)}
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="label-caps">Recurring</p>
                  {stats.recurring.length === 0 ? (
                    <p className="mt-2 text-[13px] text-ink-3">None marked</p>
                  ) : (
                    stats.recurring.map(([ccy, n]) => (
                      <p key={ccy} className="mt-1.5 font-mono text-[15px] font-medium text-ink">
                        {money(ccy, n)}
                      </p>
                    ))
                  )}
                </div>
              </div>

              {stats.dropped > 0 && (
                <p className="mt-3 text-[11px] leading-snug text-ink-3">
                  {stats.dropped} one-off {stats.dropped === 1 ? 'bill is' : 'bills are'} left out,
                  an order of magnitude above the rest.
                </p>
              )}

              {/* Vendor breakdown, biggest first. */}
              <VendorBars bills={stats.bills} onOpen={() => onFilter({ kind: 'billing' })} />
            </section>

            {/* Expiring: bills renewing and warranties running out, one timeline */}
            <section className="border-t border-line pt-8">
              <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">Expiring soon</h2>
              {expiring.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-ink-3">Nothing due in the next 30 days.</p>
              ) : (
                <div className="mt-3 space-y-px">
                  {expiring.map(({ item, date, renewal }) => {
                    const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpen(item.id)}
                        className="flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left transition hover:-translate-y-px hover:bg-hover"
                      >
                        {renewal ? (
                          <Receipt size={14} weight="bold" className="shrink-0 text-ink-3" />
                        ) : (
                          <Barcode size={14} weight="bold" className="shrink-0 text-ink-3" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{item.title}</span>
                        <span className="shrink-0 text-[10.5px] text-ink-3">
                          {renewal ? 'renews' : 'warranty'}
                        </span>
                        <span className={`shrink-0 text-[11.5px] ${days <= 7 ? 'text-fair' : 'text-ink-3'}`}>
                          {days <= 0 ? 'today' : `${days}d`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Right: Security, then Recently updated */}
          <div className="flex flex-col gap-8">
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">Security</h2>
                <button
                  type="button"
                  onClick={() => onView('health')}
                  className="flex items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink"
                >
                  Review <ArrowRight size={11} weight="bold" />
                </button>
              </div>

              <div className="mt-3 flex items-end gap-3">
                <span className={`font-mono text-[40px] font-medium leading-none ${healthTone}`}>
                  {audit.health}
                </span>
                <span className="mb-1 text-[12px] text-ink-3">/ 100</span>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-line-strong">
                <div className={`h-full rounded-full ${healthBar}`} style={{ width: `${audit.health}%` }} />
              </div>

              <div className="mt-4 space-y-px">
                <HealthRow label="Weak or critical" count={audit.fragile.length} onClick={() => onView('health')} />
                <HealthRow label="Reused" count={audit.reused.length} onClick={() => onView('health')} />
                <HealthRow label="Missing a password" count={audit.incomplete.length} onClick={() => onView('health')} />
                <HealthRow label="Assets not received" count={stats.notReceived} icon={<Package size={13} weight="bold" />} onClick={() => onFilter({ kind: 'assets' })} />
                <HealthRow label="Warranty expiring in 30 days" count={stats.warrantyExpiring} icon={<Pulse size={13} weight="bold" />} onClick={() => onFilter({ kind: 'assets' })} />
              </div>
            </section>

            {/* Recent */}
            <section className="border-t border-line pt-8">
              <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">Recently updated</h2>
              <div className="mt-3 space-y-px">
                {recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpen(item.id)}
                    className="flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left transition hover:-translate-y-px hover:bg-hover"
                  >
                    <Monogram label={item.title} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {describeUpdate(item)}
                    </span>
                    <CaretRight size={12} weight="bold" className="shrink-0 text-ink-3" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- pieces ---- */

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition hover:-translate-y-px hover:border-line-strong hover:text-ink active:translate-y-0"
    >
      <span className="text-ink-3">{icon}</span>
      {label}
    </button>
  );
}

function Tile({
  icon,
  label,
  value,
  tone = 'plain',
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'plain' | 'warn' | 'ok';
  onClick: () => void;
}) {
  const accent =
    tone === 'warn' && value > 0
      ? 'text-fair'
      : tone === 'ok'
        ? 'text-strong'
        : 'text-ink-3';
  return (
    <button
      type="button"
      onClick={onClick}
      className="group border-line px-3.5 py-4 text-left transition-colors [&:not(:last-child)]:border-r hover:bg-hover/50"
    >
      <span className={`${accent} transition-colors group-hover:text-accent`}>{icon}</span>
      <p className="mt-2.5 font-mono text-[22px] font-medium leading-none text-ink">{value}</p>
      <p className="mt-1.5 truncate text-[11.5px] text-ink-3">{label}</p>
    </button>
  );
}

function HealthRow({
  label,
  count,
  icon,
  onClick,
}: {
  label: string;
  count: number;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition hover:bg-hover"
    >
      <span className={count > 0 ? 'text-fair' : 'text-ink-3'}>
        {icon ?? <ShieldWarning size={13} weight="bold" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{label}</span>
      <span className={`shrink-0 font-mono text-[12px] ${count > 0 ? 'text-ink' : 'text-ink-3'}`}>
        {count}
      </span>
    </button>
  );
}

/**
 * Spend by vendor as proportional bars, one block per currency.
 *
 * The grouping is the whole point. Bar length only means anything against a
 * shared scale, and INR and USD do not share one: a rupee bar drawn twice the
 * length of a dollar bar says the rupee vendor costs twice as much, which is
 * not a claim the data supports. So each currency is ranked and scaled inside
 * itself, and the totals are never pooled.
 */
function VendorBars({ bills, onOpen }: { bills: VaultItem[]; onOpen: () => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const bill of bills) {
      const amount = bill.billing?.amount;
      const vendor = bill.billing?.vendor;
      if (amount == null || !vendor) continue;
      const ccy = bill.billing?.currency ?? 'USD';
      const inner = map.get(ccy) ?? new Map<string, number>();
      inner.set(vendor, (inner.get(vendor) ?? 0) + Math.abs(amount));
      map.set(ccy, inner);
    }

    return [...map.entries()]
      .map(([ccy, inner]) => {
        const rows = [...inner.entries()]
          .map(([vendor, total]) => ({ vendor, total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 4);
        return { ccy, rows, max: Math.max(1, ...rows.map((r) => r.total)) };
      })
      // Busiest currency first, so the main one leads.
      .sort((a, b) => b.rows.length - a.rows.length || a.ccy.localeCompare(b.ccy));
  }, [bills]);

  if (groups.length === 0) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="label-caps mb-3">Top vendors</p>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.ccy}>
            {groups.length > 1 && (
              <p className="mb-1.5 font-mono text-[10px] text-ink-3">{group.ccy}</p>
            )}
            <div className="space-y-1.5">
              {group.rows.map((row) => (
                <button
                  key={row.vendor}
                  type="button"
                  onClick={onOpen}
                  className="block w-full text-left"
                >
                  <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="min-w-0 truncate text-ink-2">{row.vendor}</span>
                    <span className="shrink-0 font-mono text-ink-3">
                      {money(group.ccy, row.total)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max((row.total / group.max) * 100, 2)}%`,
                        background: 'var(--chart-1)',
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
