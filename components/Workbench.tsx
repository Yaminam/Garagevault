'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LockKey,
  MagnifyingGlass,
  EyeSlash,
  Eye,
  Timer,
  Plus,
} from '@phosphor-icons/react/dist/ssr';
import type { Identity } from '@/lib/identity.ts';
import { forgetProject, listProjects, rememberProject } from '@/lib/projects.ts';
import { CATEGORIES, type ItemKind, type VaultItem } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';
import { Sidebar, type Filter } from './Sidebar.tsx';
import { ItemList } from './ItemList.tsx';
import { ItemDetail } from './ItemDetail.tsx';
import { HealthPanel } from './HealthPanel.tsx';
import { GeneratorPanel } from './GeneratorPanel.tsx';
import { AllocationPanel } from './AllocationPanel.tsx';
import { SpendPanel } from './SpendPanel.tsx';
import { DashboardPanel } from './DashboardPanel.tsx';
import { ItemEditorHost } from './ItemEditor.tsx';
import { ImportDialogHost } from './ImportDialog.tsx';
import { EnvUploadDialogHost } from './EnvUploadDialog.tsx';
import { AddProjectDialogHost } from './AddProjectDialog.tsx';
import { PrintLabelsHost } from './PrintLabels.tsx';
import { BulkInvoicesHost } from './BulkInvoices.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { IconButton } from './primitives.tsx';

export type View = 'dashboard' | 'browse' | 'health' | 'generator' | 'allocation' | 'spend';

/** Everything a query is matched against. Secret values are deliberately excluded. */
function haystack(item: VaultItem): string {
  return [
    item.title,
    item.username,
    item.email,
    item.url,
    item.entity,
    item.project,
    item.accountType,
    item.owner?.name,
    item.owner?.email,
    item.notes,
    ...item.vars.map((v) => v.key),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesFilter(item: VaultItem, filter: Filter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'logins':
      return item.kind === 'login';
    case 'environments':
      return item.kind === 'env';
    case 'billing':
      return item.kind === 'billing';
    case 'assets':
      return item.kind === 'asset';
    case 'people':
      return item.kind === 'person';
    case 'organisation':
      return item.kind === 'org';
    case 'category':
      return item.kind === 'login' && item.category === filter.id;
    case 'project':
      return item.project === filter.name;
    case 'entity':
      return item.entity === filter.name;
  }
}

/**
 * What "New" means depends on where you are. Adding from the Assets section
 * should give you an asset form, not a chooser.
 */
function kindForFilter(filter: Filter): ItemKind | null {
  switch (filter.kind) {
    case 'assets':
      return 'asset';
    case 'people':
      return 'person';
    case 'organisation':
      return 'org';
    case 'billing':
      return 'billing';
    case 'environments':
      return 'env';
    case 'logins':
    case 'category':
      return 'login';
    default:
      // Projects, entities and "all" hold a mix, so the kind is a real choice.
      return null;
  }
}

/**
 * Throws while rendering, which is the only kind of error a React error
 * boundary catches. A throw inside a click handler escapes to window.onerror
 * and the error screen never appears, so the palette flips this on instead.
 */
function CrashTest(): never {
  throw new Error(
    'Test error from the command palette. Nothing is broken, this is the error screen doing its job.',
  );
}

const NEW_LABEL: Record<ItemKind, string> = {
  login: 'login',
  env: 'environment',
  billing: 'bill',
  asset: 'asset',
  person: 'person',
  org: 'organisation',
};

function describeFilter(filter: Filter): string {
  switch (filter.kind) {
    case 'all':
      return 'All entries';
    case 'logins':
      return 'Logins';
    case 'environments':
      return 'Environments';
    case 'billing':
      return 'Billing';
    case 'assets':
      return 'Assets';
    case 'people':
      return 'People';
    case 'organisation':
      return 'Organisation';
    case 'category':
      return CATEGORIES.find((c) => c.id === filter.id)?.label ?? 'Logins';
    case 'project':
      return filter.name;
    case 'entity':
      return filter.name;
  }
}

type Props = {
  identity: Identity | null;
  onSwitchUser: () => void;
};

export function Workbench({ identity, onSwitchUser }: Props) {
  const { items, audit, lock, secondsToLock, privacy, togglePrivacy } = useVault();

  const [view, setView] = useState<View>('dashboard');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editing, setEditing] = useState<{
    item: VaultItem | null;
    kind: ItemKind;
    /** `true` when the kind came from context, so the chooser is pointless. */
    lockKind: boolean;
  } | null>(null);
  const [importing, setImporting] = useState<null | 'auto' | 'people'>(null);
  const [uploading, setUploading] = useState(false);
  const [importingInvoices, setImportingInvoices] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [crashing, setCrashing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectsRevision, setProjectsRevision] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);

  const projectNames = useMemo(
    () => listProjects(items.map((i) => i.project)).map((p) => p.name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projectsRevision],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = items.filter((item) => matchesFilter(item, filter));
    if (!needle) return pool;

    const terms = needle.split(/\s+/);
    return pool
      .map((item) => {
        const hay = haystack(item);
        if (!terms.every((term) => hay.includes(term))) return null;
        // Rank a title hit above a body hit so the obvious answer sits first.
        return { item, rank: item.title.toLowerCase().includes(terms[0]) ? 0 : 1 };
      })
      .filter((entry): entry is { item: VaultItem; rank: number } => entry !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.item);
  }, [items, filter, query]);

  // Keep the selection valid as filters narrow the list.
  useEffect(() => {
    if (view !== 'browse') return;
    if (visible.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !visible.some((item) => item.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId, view]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const sectionKind = kindForFilter(filter);
  const startNew = useCallback(
    (kind?: ItemKind) => {
      const chosen = kind ?? sectionKind;
      setEditing({ item: null, kind: chosen ?? 'login', lockKind: chosen !== null });
    },
    [sectionKind],
  );

  const openItem = useCallback((id: string) => {
    setFilter({ kind: 'all' });
    setQuery('');
    setView('browse');
    setSelectedId(id);
  }, []);

  /* -------------------------------------------------------- shortcuts ---- */

  const step = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const index = visible.findIndex((item) => item.id === selectedId);
      const next = Math.min(visible.length - 1, Math.max(0, (index === -1 ? 0 : index) + delta));
      setSelectedId(visible[next].id);
    },
    [visible, selectedId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        lock();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        startNew();
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setView('browse');
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && typing) {
        setQuery('');
        searchRef.current?.blur();
        return;
      }
      if (!typing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        step(event.key === 'ArrowDown' ? 1 : -1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock, step, startNew]);

  const minutes = Math.floor(Math.max(0, secondsToLock) / 60);
  const seconds = String(Math.max(0, secondsToLock) % 60).padStart(2, '0');
  const runningLow = secondsToLock <= 60;

  const heading =
    view === 'dashboard'
      ? 'Dashboard'
      : view === 'browse'
        ? describeFilter(filter)
        : view === 'health'
          ? 'Security review'
          : view === 'allocation'
            ? 'Who has what'
            : view === 'spend'
              ? 'Spend'
              : 'Generator';

  const subheading =
    view === 'dashboard'
      ? 'Overview'
      : view === 'browse'
        ? `${visible.length} ${visible.length === 1 ? 'entry' : 'entries'}${query ? ' matching' : ''}`
        : view === 'health'
          ? `health ${audit.health}`
          : view === 'allocation'
            ? 'by person'
            : view === 'spend'
              ? 'last 12 months'
              : 'random passwords';

  if (crashing) return <CrashTest />;

  return (
    <div className="grain flex h-[100dvh] flex-col bg-bg">
      <div className="grid min-h-0 flex-1 md:grid-cols-[236px_1fr]">
        {/* Rail */}
        <div className="hidden min-h-0 border-r border-line md:block">
          <Sidebar
            view={view}
            filter={filter}
            audit={audit}
            categories={CATEGORIES}
            items={items}
            identity={identity}
            projectsRevision={projectsRevision}
            onView={setView}
            onFilter={(next) => {
              setFilter(next);
              setView('browse');
            }}
            onImport={() => setImporting('auto')}
            onUploadFile={() => setUploading(true)}
            onImportPeople={() => setImporting('people')}
            onImportInvoices={() => setImportingInvoices(true)}
            onSwitchUser={onSwitchUser}
            onAddProject={() => setAddingProject(true)}
            onRemoveProject={(name) => {
              forgetProject(name);
              setProjectsRevision((r) => r + 1);
              // Leaving the filter pointed at a project that no longer exists
              // would strand the list on a heading with nothing under it.
              setFilter((current) =>
                current.kind === 'project' && current.name === name ? { kind: 'all' } : current,
              );
            }}
            // A new tab would have no key and so no data: the vault is only
            // decrypted in this one. Printing happens here instead.
            onPrintLabels={() => setPrinting(true)}
          />
        </div>

        <div className="flex min-h-0 flex-col">
          {/* Header */}
          <header className="relative flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-panel/30 px-3 md:px-5">
            {/* Title block. Two lines so the bar has a centre of gravity
                instead of a row of equally weighted controls. */}
            <div className="hidden min-w-0 shrink-0 md:block md:w-[180px] lg:w-[220px]">
              <p className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {heading}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10.5px] leading-tight text-ink-3">
                {subheading}
              </p>
            </div>

            {/* Command bar */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="sheen group mx-auto flex h-9 min-w-0 max-w-[460px] flex-1 items-center gap-2.5 rounded-full border border-line bg-bg/70 pl-3.5 pr-1.5 text-left transition hover:border-line-strong"
            >
              <MagnifyingGlass
                size={14}
                weight="bold"
                className="shrink-0 text-ink-3 transition-colors group-hover:text-accent"
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">
                Search entries, or jump to
              </span>
              <kbd className="hidden shrink-0 rounded-full border border-line bg-raised px-2 py-[3px] font-mono text-[10px] text-ink-3 sm:block">
                Ctrl K
              </kbd>
            </button>

            {/* Utility cluster. Grouped inside one border so the header reads as
                two objects, not six. */}
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-stretch overflow-hidden rounded-full border border-line bg-bg/70 lg:flex">
                <span
                  className={`flex items-center gap-1.5 px-3 font-mono text-[11px] tabular-nums transition-colors ${
                    runningLow ? 'text-fair' : 'text-ink-3'
                  }`}
                  title="Time left before the vault locks itself"
                >
                  <Timer size={12} weight="bold" />
                  {minutes}:{seconds}
                </span>
                <span className="w-px bg-line" aria-hidden />
                <button
                  type="button"
                  onClick={togglePrivacy}
                  title={privacy ? 'Blur on focus loss is on' : 'Blur on focus loss is off'}
                  aria-label={privacy ? 'Blur on focus loss is on' : 'Blur on focus loss is off'}
                  aria-pressed={privacy}
                  className={`grid w-9 place-items-center transition-colors ${
                    privacy ? 'text-accent hover:bg-hover' : 'text-ink-3 hover:bg-hover hover:text-ink'
                  }`}
                >
                  {privacy ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
                </button>
                <span className="w-px bg-line" aria-hidden />
                <ThemeToggle className="w-9" />
                <span className="w-px bg-line" aria-hidden />
                <button
                  type="button"
                  onClick={lock}
                  title="Lock the vault"
                  aria-label="Lock the vault"
                  className="grid w-9 place-items-center text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                >
                  <LockKey size={14} weight="bold" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => startNew()}
                className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px"
              >
                <Plus size={14} weight="bold" />
                <span className="hidden sm:inline">
                  New{sectionKind ? ` ${NEW_LABEL[sectionKind]}` : ''}
                </span>
              </button>

              {/* Small screens lose the cluster, so lock and the theme switch
                  stay reachable on their own. */}
              <span className="flex items-center gap-1 lg:hidden">
                <ThemeToggle className="h-8 w-8 rounded-[8px] border border-transparent hover:border-line" />
                <IconButton label="Lock the vault" onClick={lock}>
                  <LockKey size={15} weight="bold" />
                </IconButton>
              </span>
            </div>
          </header>

          {/* Panes */}
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(300px,352px)_1fr]">
            {view === 'browse' ? (
              <>
                <div className={`min-h-0 border-r border-line ${selected ? 'hidden lg:block' : 'block'}`}>
                  <ItemList
                    items={visible}
                    selectedId={selectedId}
                    query={query}
                    searchRef={searchRef}
                    onQuery={setQuery}
                    onSelect={setSelectedId}
                    onNew={() => startNew()}
                    onUpload={
                      filter.kind === 'people'
                        ? { label: 'Upload CSV', run: () => setImporting('people') }
                        : undefined
                    }
                  />
                </div>
                <div className={`min-h-0 ${selected ? 'block' : 'hidden lg:block'}`}>
                  <ItemDetail
                    item={selected}
                    onBack={() => setSelectedId(null)}
                    onEdit={(target) =>
                      setEditing({ item: target, kind: target.kind, lockKind: true })
                    }
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2 min-h-0">
                {view === 'dashboard' ? (
                  <DashboardPanel
                    identity={identity}
                    onFilter={(next) => {
                      setFilter(next);
                      setView('browse');
                    }}
                    onView={setView}
                    onOpen={openItem}
                  />
                ) : view === 'health' ? (
                  <HealthPanel onOpen={openItem} />
                ) : view === 'allocation' ? (
                  <AllocationPanel onOpen={openItem} />
                ) : view === 'spend' ? (
                  <SpendPanel />
                ) : (
                  <GeneratorPanel />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        items={items}
        onClose={() => setPaletteOpen(false)}
        onOpenItem={openItem}
        onNew={(kind) => startNew(kind)}
        onImport={() => setImporting('auto')}
        onView={setView}
        onLock={lock}
        onCrash={() => setCrashing(true)}
      />

      <ItemEditorHost
        open={editing !== null}
        item={editing?.item ?? null}
        initialKind={editing?.kind ?? 'login'}
        lockKind={editing?.lockKind ?? false}
        identity={identity}
        projects={projectNames}
        onProjectCreated={() => setProjectsRevision((r) => r + 1)}
        onClose={() => setEditing(null)}
      />

      <ImportDialogHost
        open={importing !== null}
        mode={importing ?? 'auto'}
        onClose={() => setImporting(null)}
      />

      <EnvUploadDialogHost
        open={uploading}
        projects={projectNames}
        onClose={() => setUploading(false)}
      />

      <PrintLabelsHost open={printing} items={items} onClose={() => setPrinting(false)} />

      <BulkInvoicesHost
        open={importingInvoices}
        onClose={() => setImportingInvoices(false)}
      />

      <AddProjectDialogHost
        open={addingProject}
        existing={projectNames}
        onCreate={(name) => {
          rememberProject(name);
          setProjectsRevision((r) => r + 1);
          setFilter({ kind: 'project', name });
          setView('browse');
        }}
        onClose={() => setAddingProject(false)}
      />
    </div>
  );
}
