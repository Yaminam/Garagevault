'use client';

import { createContext, useContext } from 'react';
import type { Audit } from '@/lib/audit.ts';
import type { Attachment } from '@/lib/attachments.ts';
import type { ItemFields, VaultItem } from '@/lib/types.ts';

export type VaultSession = {
  items: VaultItem[];
  audit: Audit;
  /** Rows the current key could not open. Non-zero means mixed master passwords. */
  unreadable: number;

  /** Copy to the clipboard, toast, and schedule an automatic clear. */
  copy: (value: string, label: string) => void;
  lock: () => void;
  /** Seconds until the idle auto-lock fires. */
  secondsToLock: number;
  privacy: boolean;
  togglePrivacy: () => void;

  createItem: (fields: ItemFields) => Promise<VaultItem>;
  saveItem: (id: string, fields: ItemFields) => Promise<VaultItem>;
  removeItem: (id: string) => Promise<void>;
  /** Encrypt and insert many entries at once. Returns how many were written. */
  importItems: (batch: ItemFields[]) => Promise<number>;
  /**
   * Encrypt a payload under a one-off key bound to the named recipient, and
   * store it as a link that burns after a set number of views.
   */
  createShare: (
    payload: unknown,
    options: { label: string; recipientName: string; hours: number; maxViews: number },
  ) => Promise<string>;

  /*
   * Files go through the session rather than being handled by components,
   * for the same reason the rows do: the derived key never leaves VaultApp.
   * A component gets to ask for a decrypted Blob, not for the key.
   */

  /** Encrypt a file in this tab and upload it. Returns the pointer to store. */
  attachFile: (file: File) => Promise<Attachment>;
  /** Download and decrypt, as a Blob carrying the original type. */
  readAttachment: (ref: Attachment) => Promise<Blob>;
  /** Remove the object from storage. The caller clears the pointer. */
  dropAttachment: (ref: Attachment) => Promise<void>;
};

const VaultContext = createContext<VaultSession | null>(null);

export function VaultProvider({ value, children }: { value: VaultSession; children: React.ReactNode }) {
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultSession {
  const session = useContext(VaultContext);
  if (!session) throw new Error('useVault must be used inside a VaultProvider');
  return session;
}
