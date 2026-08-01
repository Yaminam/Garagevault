/**
 * Expenditure, derived from billing entries.
 *
 * Two judgement calls are baked in here rather than in the components, because
 * both change the number on screen and both should live in one place:
 *
 * **Mixed currencies are not summed.** Bills arrive in whatever the vendor
 * charges. Adding INR to USD produces a figure that is wrong in every currency,
 * so each currency gets its own complete set of figures and the UI switches
 * between them. Nothing is dropped for being in the wrong denomination.
 *
 * **One-off giants are excluded.** A single annual or capital invoice an order
 * of magnitude above the rest flattens every other month into a hairline, which
 * is the one thing a spend chart must not do. A bill drops out when it is at
 * least ten times the median of *the other* bills in its currency. Measuring
 * against the others rather than against the whole set is what makes this work
 * at small sample sizes: with three bills of 500, 1200 and 371000, the median
 * of all three is 1200 but the median excluding the giant is 850, and only the
 * second comparison puts the giant far enough out to catch it. The count comes
 * back with the data so the UI can say so: a silently truncated chart is worse
 * than no chart.
 *
 * Everything below is built from one `basis()` pass so the tiles, the bars and
 * the trend line can never disagree about what was counted.
 */

import type { VaultItem } from './types.ts';

export type SpendMonth = {
  /** `YYYY-MM`, used as the React key and for ordering. */
  key: string;
  /** Short label for the axis, e.g. `Mar`. */
  short: string;
  /** Full label for the tooltip, e.g. `March 2026`. */
  label: string;
  total: number;
};

/** A ranked row: one vendor, project or plan cycle. */
export type SpendSlice = {
  name: string;
  total: number;
  count: number;
  /**
   * The same vendor's spend in the currencies this series is not denominated
   * in. Anthropic bills in both dollars and rupees, and a ranking that showed
   * only one of them read as the whole relationship when it was half of it.
   * Kept as a separate figure rather than converted: there is no rate in the
   * data, and inventing one would make up a number.
   */
  also: { currency: string; total: number }[];
};

export type Spend = {
  months: SpendMonth[];
  /** ISO code every figure is denominated in, empty when there is nothing to show. */
  currency: string;
  /** Bills left out for being an order of magnitude above the rest. */
  outliers: number;
  /** Bills left out for being in a different currency. */
  otherCurrency: number;
  /** Sum across the window. */
  total: number;
  /** Largest single month, so components can scale bars without a second pass. */
  peak: number;
  /** Mean across the whole window, including months with no spend. */
  perMonth: number;
  /**
   * What the recurring bills commit to every month: monthlies at face value,
   * yearlies divided by twelve. One-time and variable bills are not a
   * commitment and are excluded.
   */
  runRate: number;
  /** Count of bills on a recurring cycle. */
  subscriptions: number;
  /** Soonest future renewal, if any bill carries one. */
  nextRenewal: { name: string; on: string; amount: number | null } | null;
  byVendor: SpendSlice[];
  byProject: SpendSlice[];
  /** Running total across `months`, same length and order. */
  cumulative: number[];
};

/** A bill at or above this multiple of the others' median is a one-off. */
const OUTLIER_FACTOR = 10;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Which bills are one-offs, by index.
 *
 * Each amount is judged against the median of the others, excluding itself, so
 * a single giant cannot drag up the very baseline it is being measured against.
 * Indices rather than values because two bills can legitimately be identical.
 * Quadratic, on a list that is never more than a few hundred long.
 */
function outlierFlags(amounts: number[]): boolean[] {
  if (amounts.length < 2) return amounts.map(() => false);

  return amounts.map((amount, index) => {
    const others = amounts.filter((_, other) => other !== index);
    const baseline = median(others);
    return baseline > 0 && amount >= baseline * OUTLIER_FACTOR;
  });
}

/**
 * The date a bill counts against. `paidOn` is the real expenditure; renewals
 * are the fallback so scheduled costs still land somewhere, which matches how
 * the entry list already orders billing rows.
 */
function dateOf(item: VaultItem): string | null {
  return item.billing?.paidOn ?? item.billing?.nextRenewal ?? null;
}

function monthKey(when: Date): string {
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Ranked totals for one grouping, largest first, empty names dropped.
 *
 * `elsewhere` carries the same names totalled in the other currencies, so a
 * row can say that the vendor is also billing in rupees without those figures
 * being mixed into the ranking. Matching is case-insensitive because "OpenAI"
 * and "openai" are one vendor spelled two ways across imported invoices.
 */
function rank(
  bills: VaultItem[],
  nameOf: (item: VaultItem) => string | null,
  elsewhere: Map<string, Map<string, number>> = new Map(),
): SpendSlice[] {
  const map = new Map<string, SpendSlice>();
  for (const bill of bills) {
    const name = nameOf(bill)?.trim();
    if (!name) continue;
    const row = map.get(name) ?? { name, total: 0, count: 0, also: [] };
    row.total += Math.abs(bill.billing!.amount!);
    row.count += 1;
    map.set(name, row);
  }

  for (const row of map.values()) {
    const others = elsewhere.get(row.name.toLowerCase());
    if (!others) continue;
    row.also = [...others.entries()]
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, b) => b.total - a.total);
  }

  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

const EMPTY: Spend = {
  months: [],
  currency: '',
  outliers: 0,
  otherCurrency: 0,
  total: 0,
  peak: 0,
  perMonth: 0,
  runRate: 0,
  subscriptions: 0,
  nextRenewal: null,
  byVendor: [],
  byProject: [],
  cumulative: [],
};

const codeOf = (bill: VaultItem): string =>
  (bill.billing!.currency || '').toUpperCase() || 'USD';

const billsIn = (items: VaultItem[]): VaultItem[] =>
  items.filter((item) => item.kind === 'billing' && item.billing && item.billing.amount != null);

/**
 * Every currency with bills against it, most-billed first. Ties break
 * alphabetically so the order is stable across renders rather than dependent
 * on row order. This is what the UI offers as a switch.
 */
export function spendCurrencies(items: VaultItem[]): string[] {
  const counts = new Map<string, number>();
  for (const bill of billsIn(items)) {
    counts.set(codeOf(bill), (counts.get(codeOf(bill)) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code]) => code);
}

/**
 * Bills with the one-offs taken out, judged per currency.
 *
 * For callers that do their own totalling and just need the giants gone. The
 * flagging has to happen inside each currency: a 371,700 INR invoice is not an
 * outlier because it is a big number, it is an outlier because it is a hundred
 * times every other rupee bill, and comparing it against dollar amounts would
 * mean nothing.
 */
export function excludeOutliers(items: VaultItem[]): { kept: VaultItem[]; dropped: number } {
  const bills = billsIn(items);
  const groups = new Map<string, VaultItem[]>();
  for (const bill of bills) {
    const code = codeOf(bill);
    groups.set(code, [...(groups.get(code) ?? []), bill]);
  }

  const kept: VaultItem[] = [];
  for (const group of groups.values()) {
    const flags = outlierFlags(group.map((bill) => Math.abs(bill.billing!.amount!)));
    group.forEach((bill, index) => {
      if (!flags[index]) kept.push(bill);
    });
  }

  return { kept, dropped: bills.length - kept.length };
}

/** Pass a currency to chart that one; omit it for whichever has the most bills. */
export function analyseSpend(
  items: VaultItem[],
  monthCount = 12,
  want?: string | null,
): Spend {
  const bills = billsIn(items);
  if (bills.length === 0) return EMPTY;

  const available = spendCurrencies(items);
  const currency = want && available.includes(want) ? want : available[0];

  const inCurrency = bills.filter((bill) => codeOf(bill) === currency);
  const otherCurrency = bills.length - inCurrency.length;

  const flags = outlierFlags(inCurrency.map((bill) => Math.abs(bill.billing!.amount!)));
  const counted = inCurrency.filter((_, index) => !flags[index]);
  const outliers = inCurrency.length - counted.length;

  // Build the window first so months with no spend still appear. A gap in a
  // time series has to be drawn as a zero, not skipped, or the axis lies.
  const now = new Date();
  const buckets = new Map<string, number>();
  const order: SpendMonth[] = [];

  for (let back = monthCount - 1; back >= 0; back -= 1) {
    const when = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = monthKey(when);
    buckets.set(key, 0);
    order.push({
      key,
      short: when.toLocaleDateString(undefined, { month: 'short' }),
      label: when.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      total: 0,
    });
  }

  /** Only the bills that landed inside the charted window. */
  const inWindow: VaultItem[] = [];
  for (const bill of counted) {
    const iso = dateOf(bill);
    if (!iso) continue;
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) continue;

    const key = monthKey(when);
    if (!buckets.has(key)) continue;
    buckets.set(key, buckets.get(key)! + Math.abs(bill.billing!.amount!));
    inWindow.push(bill);
  }

  const months = order.map((month) => ({ ...month, total: buckets.get(month.key) ?? 0 }));
  const total = months.reduce((sum, month) => sum + month.total, 0);
  const peak = months.reduce((high, month) => Math.max(high, month.total), 0);

  let running = 0;
  const cumulative = months.map((month) => (running += month.total));

  // Commitment is a property of the bill, not of the window, so it is measured
  // across every counted bill rather than only the ones that landed in range.
  let runRate = 0;
  let subscriptions = 0;
  for (const bill of counted) {
    const amount = Math.abs(bill.billing!.amount!);
    if (bill.billing!.cycle === 'monthly') {
      runRate += amount;
      subscriptions += 1;
    } else if (bill.billing!.cycle === 'yearly') {
      runRate += amount / 12;
      subscriptions += 1;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const nextRenewal =
    counted
      .filter((bill) => bill.billing!.nextRenewal && bill.billing!.nextRenewal! >= today)
      .sort((a, b) => a.billing!.nextRenewal!.localeCompare(b.billing!.nextRenewal!))
      .map((bill) => ({
        name: bill.billing!.vendor ?? bill.title,
        on: bill.billing!.nextRenewal!,
        amount: bill.billing!.amount,
      }))[0] ?? null;

  /*
   * The same vendors, totalled in every other currency over the same window
   * and with each currency's own outliers removed. A vendor billing in both
   * dollars and rupees would otherwise appear at half its real size, and the
   * missing half is not visible anywhere on the page. Totals are reported
   * side by side, never converted: the data carries no exchange rate, and
   * picking one would be inventing a number.
   */
  const windowKeys = new Set(order.map((month) => month.key));
  const elsewhere = new Map<string, Map<string, number>>();

  for (const code of available) {
    if (code === currency) continue;
    const group = bills.filter((bill) => codeOf(bill) === code);
    const groupFlags = outlierFlags(group.map((bill) => Math.abs(bill.billing!.amount!)));

    group.forEach((bill, index) => {
      if (groupFlags[index]) return;
      const iso = dateOf(bill);
      if (!iso) return;
      const when = new Date(iso);
      if (Number.isNaN(when.getTime()) || !windowKeys.has(monthKey(when))) return;

      const name = (bill.billing?.vendor ?? bill.entity)?.trim();
      if (!name) return;

      const key = name.toLowerCase();
      const inner = elsewhere.get(key) ?? new Map<string, number>();
      inner.set(code, (inner.get(code) ?? 0) + Math.abs(bill.billing!.amount!));
      elsewhere.set(key, inner);
    });
  }

  return {
    months,
    currency,
    outliers,
    otherCurrency,
    total,
    peak,
    perMonth: total / monthCount,
    runRate,
    subscriptions,
    nextRenewal,
    byVendor: rank(inWindow, (bill) => bill.billing?.vendor ?? bill.entity, elsewhere),
    byProject: rank(inWindow, (bill) => bill.project),
    cumulative,
  };
}

/** The rail wants a shorter window than the page does. */
export function monthlySpend(items: VaultItem[], monthCount = 9): Spend {
  return analyseSpend(items, monthCount);
}

/**
 * Compact money, e.g. `$1.2K` or `₹3.4L`. Compact notation is locale-aware, so
 * an Indian total reads in lakhs rather than being forced into thousands.
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    // An unrecognised or symbol-style currency string reaches here.
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}
