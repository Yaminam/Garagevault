'use client';

/**
 * Session orchestrator.
 *
 * Owns the lifecycle: read the vault metadata, derive the key from the master
 * password, decrypt every row, and drop the key on idle. The derived key lives
 * in a ref and is never written to storage, so a refresh always returns to the
 * lock screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, WarningOctagon } from '@phosphor-icons/react/dist/ssr';
import {
  PBKDF2_ITERATIONS,
  checkVerifier,
  deriveKey,
  deriveKeyBits,
  importAesKey,
  makeVerifier,
  randomSalt,
} from '@/lib/crypto.ts';
import { unlockWithAccount } from '@/lib/users.ts';
import { auditVault } from '@/lib/audit.ts';
import {
  SchemaMissingError,
  backfillKinds,
  deleteItem,
  fetchMeta,
  insertItem,
  insertMany,
  loadItems,
  updateItem,
  writeMeta,
} from '@/lib/repository.ts';
import { createShare } from '@/lib/shares.ts';
import {
  deleteAttachment,
  readAttachment,
  uploadAttachment,
  type Attachment,
} from '@/lib/attachments.ts';
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from '@/lib/identity.ts';
import { MissingConfigError, getBrowserClient, type Client } from '@/lib/supabase.ts';
import type { ItemFields, VaultItem, VaultMeta } from '@/lib/types.ts';
import { IdentityGate } from './IdentityGate.tsx';
import { LockScreen } from './LockScreen.tsx';
import { Workbench } from './Workbench.tsx';
import { ToastProvider, useToast } from './primitives.tsx';
import { VaultProvider, type VaultSession } from './vault-context.tsx';

/** Idle time before the vault locks itself. */
const IDLE_LIMIT_SECONDS = 5 * 60;
/** How long a copied secret is allowed to sit on the clipboard. */
const CLIPBOARD_TTL_SECONDS = 30;

type Phase =
  | { kind: 'loading' }
  | { kind: 'blocked'; title: string; message: string; hint?: string }
  | { kind: 'setup' }
  | { kind: 'locked'; meta: VaultMeta }
  | { kind: 'unlocked'; meta: VaultMeta; items: VaultItem[]; unreadable: number };

export function VaultApp() {
  return (
    <ToastProvider>
      <VaultAppInner />
    </ToastProvider>
  );
}

function VaultAppInner() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsToLock, setSecondsToLock] = useState(IDLE_LIMIT_SECONDS);
  const [privacy, setPrivacy] = useState(true);
  const [obscured, setObscured] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [askingIdentity, setAskingIdentity] = useState(false);

  // Read once on mount: localStorage is not available during the server render.
  useEffect(() => {
    setIdentity(loadIdentity());
  }, []);

  const toast = useToast();
  const keyRef = useRef<CryptoKey | null>(null);
  const clientRef = useRef<Client | null>(null);
  const clipboardTimer = useRef<number | null>(null);

  const client = useCallback((): Client => {
    if (!clientRef.current) clientRef.current = getBrowserClient();
    return clientRef.current;
  }, []);

  /* --------------------------------------------------------- bootstrap ---- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meta = await fetchMeta(client());
        if (cancelled) return;
        setPhase(meta ? { kind: 'locked', meta } : { kind: 'setup' });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof SchemaMissingError) {
          setPhase({
            kind: 'blocked',
            title: 'Database not migrated yet',
            message:
              'The Supabase project is reachable but the vault tables do not exist. Apply the migration, then reload this page.',
            hint: 'npm run db:push',
          });
        } else if (error instanceof MissingConfigError) {
          setPhase({
            kind: 'blocked',
            title: 'Supabase is not configured',
            message: error.message,
            hint: '.env.local',
          });
        } else {
          setPhase({
            kind: 'blocked',
            title: 'Could not reach Supabase',
            message: error instanceof Error ? error.message : 'Unknown error.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  /* ------------------------------------------------------------- unlock ---- */

  const hydrate = useCallback(
    async (meta: VaultMeta, key: CryptoKey) => {
      const { items, unreadable } = await loadItems(client(), key);
      keyRef.current = key;
      setPhase({ kind: 'unlocked', meta, items, unreadable });

      // Rows written before the `kind` column existed cannot be labelled by the
      // server, which has no key. Best effort, and harmless if it fails.
      void backfillKinds(client(), items).catch(() => {});
      setSecondsToLock(IDLE_LIMIT_SECONDS);
      if (unreadable > 0) {
        toast.push(`${unreadable} rows were written with a different master password`, 'warn');
      }
    },
    [client, toast],
  );

  const unlock = useCallback(
    async (password: string) => {
      setBusy(true);
      setUnlockError(null);
      // Yield a frame so the button reaches its working state before the key
      // derivation blocks the main thread.
      await new Promise((resolve) => setTimeout(resolve, 40));

      try {
        if (phase.kind === 'setup') {
          const meta: VaultMeta = {
            kdfSalt: randomSalt(),
            kdfIterations: PBKDF2_ITERATIONS,
            verifierIv: '',
            verifierCt: '',
          };
          const key = await deriveKey(password, meta.kdfSalt, meta.kdfIterations);
          const verifier = await makeVerifier(key);
          meta.verifierIv = verifier.iv;
          meta.verifierCt = verifier.ciphertext;

          await writeMeta(client(), meta);
          await hydrate(meta, key);
          toast.push('Vault created');
          return;
        }

        if (phase.kind !== 'locked') return;

        /*
         * One derivation serves both routes. The salt and iteration count are
         * shared, so these bytes are at once a candidate vault key, which the
         * verifier settles, and a candidate unwrapping key for the account
         * records. Deriving per account would mean a PBKDF2 run each and an
         * unlock that gets slower every time somebody is added.
         */
        const bits = await deriveKeyBits(
          password,
          phase.meta.kdfSalt,
          phase.meta.kdfIterations,
        );
        const candidate = await importAesKey(bits);

        if (
          await checkVerifier(candidate, {
            iv: phase.meta.verifierIv,
            ciphertext: phase.meta.verifierCt,
          })
        ) {
          // The original master password. It belongs to no one in particular,
          // so the identity prompt still decides who is using this browser.
          await hydrate(phase.meta, candidate);
          return;
        }

        const account = await unlockWithAccount(client(), candidate, phase.meta);
        if (!account) {
          setUnlockError('That password did not unlock the vault.');
          return;
        }

        // A password that knows who it belongs to answers the identity
        // question by being used, so the prompt is skipped.
        if (account.identity) {
          saveIdentity(account.identity);
          setIdentity(account.identity);
        }
        await hydrate(phase.meta, account.key);
      } catch (error) {
        setUnlockError(error instanceof Error ? error.message : 'Could not open the vault.');
      } finally {
        setBusy(false);
      }
    },
    [phase, client, hydrate, toast],
  );

  const lock = useCallback(() => {
    keyRef.current = null;
    setPhase((current) =>
      current.kind === 'unlocked' ? { kind: 'locked', meta: current.meta } : current,
    );
    setUnlockError(null);
    setSecondsToLock(IDLE_LIMIT_SECONDS);
  }, []);

  /* ---------------------------------------------------------- idle lock ---- */

  const unlocked = phase.kind === 'unlocked';

  useEffect(() => {
    if (!unlocked) return;

    let remaining = IDLE_LIMIT_SECONDS;
    const bump = () => {
      remaining = IDLE_LIMIT_SECONDS;
      setSecondsToLock(remaining);
    };

    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const event of events) window.addEventListener(event, bump, { passive: true });

    const tick = window.setInterval(() => {
      remaining -= 1;
      setSecondsToLock(remaining);
      if (remaining <= 0) {
        lock();
        toast.push('Vault locked after 5 minutes idle', 'warn');
      }
    }, 1000);

    return () => {
      for (const event of events) window.removeEventListener(event, bump);
      window.clearInterval(tick);
    };
  }, [unlocked, lock, toast]);

  /* ----------------------------------------------------------- privacy ---- */

  useEffect(() => {
    if (!unlocked || !privacy) {
      setObscured(false);
      return;
    }
    const hide = () => setObscured(true);
    const show = () => setObscured(false);
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
    };
  }, [unlocked, privacy]);

  /* --------------------------------------------------------- clipboard ---- */

  const copy = useCallback(
    (value: string, label: string) => {
      navigator.clipboard
        .writeText(value)
        .then(() => {
          toast.push(`${label} copied, clears in ${CLIPBOARD_TTL_SECONDS}s`);
          if (clipboardTimer.current) window.clearTimeout(clipboardTimer.current);
          clipboardTimer.current = window.setTimeout(() => {
            navigator.clipboard.writeText('').catch(() => {});
          }, CLIPBOARD_TTL_SECONDS * 1000);
        })
        .catch(() => toast.push('Could not reach the clipboard', 'warn'));
    },
    [toast],
  );

  useEffect(
    () => () => {
      if (clipboardTimer.current) window.clearTimeout(clipboardTimer.current);
    },
    [],
  );

  /* -------------------------------------------------------------- crud ---- */

  const replaceItems = useCallback((update: (items: VaultItem[]) => VaultItem[]) => {
    setPhase((current) =>
      current.kind === 'unlocked' ? { ...current, items: update(current.items) } : current,
    );
  }, []);

  const createItem = useCallback(
    async (fields: ItemFields) => {
      const key = keyRef.current;
      if (!key) throw new Error('Vault is locked.');
      const item = await insertItem(client(), key, fields);
      replaceItems((items) => [item, ...items].sort((a, b) => a.title.localeCompare(b.title)));
      toast.push('Entry added');
      return item;
    },
    [client, replaceItems, toast],
  );

  const saveItem = useCallback(
    async (id: string, fields: ItemFields) => {
      const key = keyRef.current;
      if (!key) throw new Error('Vault is locked.');
      const item = await updateItem(client(), key, id, fields);
      replaceItems((items) =>
        items.map((existing) => (existing.id === id ? item : existing)).sort((a, b) => a.title.localeCompare(b.title)),
      );
      toast.push('Changes saved');
      return item;
    },
    [client, replaceItems, toast],
  );

  const removeItem = useCallback(
    async (id: string) => {
      await deleteItem(client(), id);
      replaceItems((items) => items.filter((item) => item.id !== id));
      toast.push('Entry deleted');
    },
    [client, replaceItems, toast],
  );

  const importItems = useCallback(
    async (batch: ItemFields[]) => {
      const key = keyRef.current;
      if (!key) throw new Error('Vault is locked.');
      if (batch.length === 0) return 0;

      await insertMany(client(), key, batch);
      // Re-read rather than guessing: the insert returns no ids, and this also
      // picks up anything a second tab wrote in the meantime.
      const { items, unreadable } = await loadItems(client(), key);
      setPhase((current) =>
        current.kind === 'unlocked' ? { ...current, items, unreadable } : current,
      );
      return batch.length;
    },
    [client],
  );

  const share = useCallback(
    async (
      payload: unknown,
      options: { label: string; recipientName: string; hours: number; maxViews: number },
    ) => createShare(client(), window.location.origin, payload, options),
    [client],
  );

  /* ------------------------------------------------------------- files ---- */

  // The key stays in this ref. Components ask for a decrypted Blob and never
  // see the CryptoKey, which is the same boundary the row helpers keep.
  const attachFile = useCallback(
    async (file: File) => {
      const key = keyRef.current;
      if (!key) throw new Error('Vault is locked.');
      return uploadAttachment(client(), key, file);
    },
    [client],
  );

  const readFile = useCallback(
    async (ref: Attachment) => {
      const key = keyRef.current;
      if (!key) throw new Error('Vault is locked.');
      return readAttachment(client(), key, ref);
    },
    [client],
  );

  const dropFile = useCallback(
    async (ref: Attachment) => deleteAttachment(client(), ref),
    [client],
  );

  /* ------------------------------------------------------------ render ---- */

  const session: VaultSession | null = useMemo(() => {
    if (phase.kind !== 'unlocked') return null;
    return {
      items: phase.items,
      audit: auditVault(phase.items),
      unreadable: phase.unreadable,
      copy,
      lock,
      secondsToLock,
      privacy,
      togglePrivacy: () => setPrivacy((p) => !p),
      createItem,
      saveItem,
      removeItem,
      importItems,
      createShare: share,
      attachFile,
      readAttachment: readFile,
      dropAttachment: dropFile,
    };
  }, [
    phase,
    copy,
    lock,
    secondsToLock,
    privacy,
    createItem,
    saveItem,
    removeItem,
    importItems,
    share,
    attachFile,
    readFile,
    dropFile,
  ]);

  if (phase.kind === 'loading') {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-bg">
        <p className="label-caps animate-pulse">Connecting to the vault</p>
      </main>
    );
  }

  if (phase.kind === 'blocked') {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-bg px-6">
        <div className="panel max-w-[460px] p-7">
          <span className="grid h-9 w-9 place-items-center rounded-[8px] border border-fair/30 bg-fair/10 text-fair">
            {phase.title.includes('migrated') ? (
              <Database size={17} weight="bold" />
            ) : (
              <WarningOctagon size={17} weight="bold" />
            )}
          </span>
          <h1 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">{phase.title}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{phase.message}</p>
          {phase.hint && (
            <pre className="mt-4 overflow-x-auto rounded-[8px] border border-line bg-bg px-3 py-2.5 font-mono text-[12px] text-ink-2">
              {phase.hint}
            </pre>
          )}
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <LockScreen
        mode={phase.kind === 'setup' ? 'create' : 'unlock'}
        iterations={phase.kind === 'locked' ? phase.meta.kdfIterations : PBKDF2_ITERATIONS}
        error={unlockError}
        busy={busy}
        onSubmit={unlock}
      />
    );
  }

  // Asked once per browser, after unlocking, so entries get a real owner.
  if (!identity || askingIdentity) {
    return (
      <IdentityGate
        onDone={(next) => {
          saveIdentity(next);
          setIdentity(next);
          setAskingIdentity(false);
        }}
      />
    );
  }

  return (
    <VaultProvider value={session}>
      <div className={obscured ? 'privacy-blur' : undefined}>
        <Workbench
          identity={identity}
          onSwitchUser={() => {
            clearIdentity();
            setAskingIdentity(true);
          }}
        />
      </div>
    </VaultProvider>
  );
}
