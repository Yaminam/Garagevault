'use client';

import { useMemo } from 'react';
import {
  ArrowRight,
  Barcode,
  CaretRight,
  FileText,
  Key,
  Package,
  Pulse,
  Receipt,
  ShieldWarning,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import { excludeOutliers } from '@/lib/spend.ts';
import type { Identity } from '@/lib/identity.ts';
import { BILLING_CYCLE_LABEL, type VaultItem } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';
import { Monogram } from './primitives.tsx';

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

export function DashboardPanel({ identity, onFilter, onView, onOpen }: Props) {
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

  // Renewals in the next 30 days, soonest first.
  const renewals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    return items
      .filter((i) => {
        const d = i.billing?.nextRenewal;
        return d && d >= today && d <= horizon;
      })
      .sort((a, b) => (a.billing!.nextRenewal! < b.billing!.nextRenewal! ? -1 : 1))
      .slice(0, 6);
  }, [items]);

  // Most recently touched, as a "where was I" list.
  const recent = useMemo(
    () =>
      [...items]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 6),
    [items],
  );

  const attention =
    audit.fragile.length +
    audit.reused.length +
    audit.incomplete.length +
    stats.notReceived +
    stats.warrantyExpiring;

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

        {/*
          One continuous band split by hairlines rather than six bordered
          cards. The counts are the content; a box around each one added a
          rectangle per number and no meaning, and six identical cards in a row
          is the most templated shape a dashboard can open with.
        */}
        <div className="mt-7 grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-6">
          <Tile icon={<Key size={16} weight="bold" />} label="Logins" value={stats.logins} onClick={() => onFilter({ kind: 'logins' })} />
          <Tile icon={<FileText size={16} weight="bold" />} label="Environments" value={stats.envs} onClick={() => onFilter({ kind: 'environments' })} />
          <Tile icon={<Receipt size={16} weight="bold" />} label="Bills" value={stats.billsCount} onClick={() => onFilter({ kind: 'billing' })} />
          <Tile icon={<Barcode size={16} weight="bold" />} label="Assets" value={stats.assetsCount} onClick={() => onFilter({ kind: 'assets' })} />
          <Tile icon={<UsersThree size={16} weight="bold" />} label="People" value={stats.people} onClick={() => onFilter({ kind: 'people' })} />
          <Tile icon={<WarningCircle size={16} weight="bold" />} label="Needs attention" value={attention} tone={attention > 0 ? 'warn' : 'ok'} onClick={() => onView('health')} />
        </div>

        {/* Two regions side by side, divided by a rule rather than boxed. */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10 lg:divide-x lg:divide-line">
          {/* Spend */}
          <section className="lg:pr-10">
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

          {/* Health */}
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
        </div>

        <div className="mt-8 grid gap-8 border-t border-line pt-8 lg:grid-cols-2 lg:gap-10 lg:divide-x lg:divide-line">
          {/* Renewals */}
          <section className="lg:pr-10">
            <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">Renewing soon</h2>
            {renewals.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-ink-3">Nothing due in the next 30 days.</p>
            ) : (
              <div className="mt-3 space-y-px">
                {renewals.map((bill) => {
                  const days = Math.ceil(
                    (new Date(bill.billing!.nextRenewal!).getTime() - Date.now()) / 86_400_000,
                  );
                  return (
                    <button
                      key={bill.id}
                      type="button"
                      onClick={() => onOpen(bill.id)}
                      className="flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left transition hover:bg-hover"
                    >
                      <Receipt size={14} weight="bold" className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{bill.title}</span>
                      <span className={`shrink-0 text-[11.5px] ${days <= 7 ? 'text-fair' : 'text-ink-3'}`}>
                        {days === 0 ? 'today' : `${days}d`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent */}
          <section>
            <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">Recently updated</h2>
            <div className="mt-3 space-y-px">
              {recent.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left transition hover:bg-hover"
                >
                  <Monogram label={item.title} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{item.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{item.kind}</span>
                  <CaretRight size={12} weight="bold" className="shrink-0 text-ink-3" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- pieces ---- */

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
