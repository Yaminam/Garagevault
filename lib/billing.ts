/**
 * Invoice guess -> billing entry.
 *
 * Shared by the single-invoice scanner in the editor and the bulk folder
 * importer, so a bill created either way is filled exactly the same. Keeping
 * this in one place is the whole reason the two paths cannot drift.
 */

import type { InvoiceGuess } from './ocr.ts';
import { emptyBilling, type ItemFields } from './types.ts';

/**
 * A readable name for a scanned document. Vendor alone is usually right, but a
 * month makes a run of invoices from the same vendor tellable apart in a list.
 */
export function billingTitleFrom(guess: {
  vendor: string | null;
  invoiceNumber: string | null;
  date: string | null;
}): string | null {
  if (guess.vendor) {
    if (!guess.date) return guess.vendor;
    const when = new Date(guess.date);
    if (Number.isNaN(when.getTime())) return guess.vendor;
    return `${guess.vendor} ${when.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    })}`;
  }
  return guess.invoiceNumber ? `Invoice ${guess.invoiceNumber}` : null;
}

/** Fields the scanner touched, so the UI can say what it changed. */
export const filledLabels = (guess: InvoiceGuess): string[] =>
  (
    [
      [guess.vendor, 'Vendor'],
      [guess.plan, 'Plan'],
      [guess.amount, 'Amount'],
      [guess.currency, 'Currency'],
      [guess.cycle, 'Cycle'],
      [guess.date, 'Paid on'],
      [guess.invoiceNumber, 'Invoice number'],
      [guess.billingEmail, 'Billing email'],
    ] as const
  )
    .filter(([value]) => value != null)
    .map(([, label]) => label);

/**
 * Merge an invoice guess into a billing item. Given no base, starts from a
 * blank billing entry, which is what the bulk importer needs.
 */
export function applyInvoice(guess: InvoiceGuess, base?: ItemFields): ItemFields {
  const start = base ?? emptyBilling();
  const billing = start.billing ?? emptyBilling().billing!;

  return {
    ...start,
    title: billingTitleFrom(guess) ?? start.title,
    billing: {
      ...billing,
      vendor: guess.vendor ?? billing.vendor,
      plan: guess.plan ?? billing.plan,
      amount: guess.amount ?? billing.amount,
      currency: guess.currency ?? billing.currency,
      invoiceNumber: guess.invoiceNumber ?? billing.invoiceNumber,
      paidOn: guess.date ?? billing.paidOn,
      billingEmail: guess.billingEmail ?? billing.billingEmail,
      // A due date is the next charge only for a recurring bill. On a one-off
      // it is just when this bill was payable, so it is not a renewal.
      nextRenewal:
        guess.cycle && guess.cycle !== 'one-time'
          ? (guess.dueDate ?? billing.nextRenewal)
          : billing.nextRenewal,
      cycle: guess.cycle ?? billing.cycle,
      scannedAt: new Date().toISOString(),
    },
  };
}
