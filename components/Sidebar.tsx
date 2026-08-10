'use client';

import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Stack,
  EnvelopeSimple,
  ShieldCheck,
  ShareNetwork,
  Database,
  Key,
  Pulse,
  Sparkle,
  Buildings,
  FileText,
  FolderSimple,
  FileXls,
  SignOut,
  Plus,
  Receipt,
  Barcode,
  Printer,
  UsersThree,
  ArrowsLeftRight,
  UploadSimple,
  SquaresFour,
  ChartLineUp,
  FileArrowUp,
  X,
} from '@phosphor-icons/react/dist/ssr';
import type { Audit } from '@/lib/audit.ts';
import { initialsOf, type Identity } from '@/lib/identity.ts';
import { listProjects } from '@/lib/projects.ts';
import type { Category, CategoryId, VaultItem } from '@/lib/types.ts';
import { SpendChart } from './SpendChart.tsx';
import type { View } from './Workbench.tsx';

export type Filter =
  | { kind: 'all' }
  | { kind: 'logins' }
  | { kind: 'environments' }
  | { kind: 'billing' }
  | { kind: 'assets' }
  | { kind: 'people' }
  | { kind: 'organisation' }
  | { kind: 'category'; id: CategoryId }
  | { kind: 'project'; name: string }
  | { kind: 'entity'; name: string };

type IconType = React.ComponentType<{ size?: number; weight?: 'bold'; className?: string }>;

const CATEGORY_ICON: Record<string, IconType> = {
  mail: EnvelopeSimple,
  shield: ShieldCheck,
  share: ShareNetwork,
  database: Database,
  key: Key,
};

type Props = {
  view: View;
  filter: Filter;
  audit: Audit;
  categories: Category[];
  items: VaultItem[];
  identity: Identity | null;
  /** Bumped when a project is created, so the derived list re-reads storage. */
  projectsRevision: number;
  onView: (view: View) => void;
  onFilter: (filter: Filter) => void;
  onImport: () => void;
  /** Opens the any-file uploader: .env, text, Word, PDF or a photo. */
  onUploadFile: () => void;
  onImportPeople: () => void;
  onImportInvoices: () => void;
  onSwitchUser: () => void;
  onAddProject: () => void;
  /**
   * Discard an empty project. Only offered at zero entries: the list is derived
   * from the entries themselves, so a project in use would come straight back.
   */
  onRemoveProject: (name: string) => void;
  onPrintLabels: () => void;
};

export function Sidebar({
  view,
  filter,
  audit,
  categories,
  items,
  identity,
  projectsRevision,
  onView,
  onFilter,
  onImport,
  onUploadFile,
  onImportPeople,
  onImportInvoices,
  onSwitchUser,
  onAddProject,
  onRemoveProject,
  onPrintLabels,
}: Props) {
  const reduce = useReducedMotion();

  const categoryCounts = useMemo(() => {
    const map = new Map<CategoryId, number>();
    for (const item of items) {
      if (item.kind === 'login') map.set(item.category, (map.get(item.category) ?? 0) + 1);
    }
    return map;
  }, [items]);

  // Includes projects created before anything was filed under them.
  const projects = useMemo(
    () => listProjects(items.map((i) => i.project)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projectsRevision],
  );
  const browsing = view === 'browse';
  const is = (test: (f: Filter) => boolean) => browsing && test(filter);

  const healthTone = audit.health >= 75 ? 'bg-strong' : audit.health >= 45 ? 'bg-fair' : 'bg-weak';
  const healthInk = audit.health >= 75 ? 'text-strong' : audit.health >= 45 ? 'text-fair' : 'text-weak';

  // `key` is passed as its own argument rather than living in the props object.
  // React strips it before the component sees it, so spreading it in silently
  // produces a keyless list.
  const row = (key: string, props: Omit<RowProps, 'reduce'>) => (
    <Row key={key} {...props} reduce={!!reduce} />
  );

  return (
    <nav className="flex h-full flex-col bg-panel/40" aria-label="Vault navigation">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <span className="sheen grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[9px] border border-line bg-raised">
          {/* Monochrome lockup, knocked to white on dark and to black on paper. */}
          <img src="/logo-dark.png" alt="" width={30} height={30} className="logo-adaptive" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            Garage Collective
          </span>
          <span className="block font-mono text-[10.5px] leading-tight text-ink-3">vault</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <Section>
          {row('dashboard', {
            icon: <SquaresFour size={15} weight="bold" />,
            label: 'Dashboard',
            active: view === 'dashboard',
            onClick: () => onView('dashboard'),
          })}
          {row('all', {
            icon: <Stack size={15} weight="bold" />,
            label: 'All entries',
            count: items.length,
            active: is((f) => f.kind === 'all'),
            onClick: () => onFilter({ kind: 'all' }),
          })}
          {row('billing', {
            icon: <Receipt size={15} weight="bold" />,
            label: 'Billing',
            count: items.filter((i) => i.kind === 'billing').length,
            active: is((f) => f.kind === 'billing'),
            onClick: () => onFilter({ kind: 'billing' }),
          })}
          {row('assets', {
            icon: <Barcode size={15} weight="bold" />,
            label: 'Assets',
            count: items.filter((i) => i.kind === 'asset').length,
            active: is((f) => f.kind === 'assets'),
            onClick: () => onFilter({ kind: 'assets' }),
          })}
          {row('upload-invoices', {
            icon: <UploadSimple size={15} weight="bold" />,
            label: 'Upload invoices',
            active: false,
            onClick: onImportInvoices,
          })}
        </Section>

        <Heading>Organisation</Heading>
        <Section>
          {row('company', {
            icon: <Buildings size={15} weight="bold" />,
            label: 'Company details',
            count: items.filter((i) => i.kind === 'org').length,
            active: is((f) => f.kind === 'organisation'),
            onClick: () => onFilter({ kind: 'organisation' }),
          })}
          {row('people', {
            icon: <UsersThree size={15} weight="bold" />,
            label: 'People',
            count: items.filter((i) => i.kind === 'person').length,
            active: is((f) => f.kind === 'people'),
            onClick: () => onFilter({ kind: 'people' }),
          })}
          {row('upload-people', {
            icon: <UploadSimple size={15} weight="bold" />,
            label: 'Upload employees',
            active: false,
            onClick: onImportPeople,
          })}
          {row('allocation', {
            icon: <ArrowsLeftRight size={15} weight="bold" />,
            label: 'Who has what',
            active: view === 'allocation',
            onClick: () => onView('allocation'),
          })}
        </Section>

        {/* Projects are the spine: a project holds both its logins and its
            environment files, so there is no separate section for env. */}
        <div className="flex items-center justify-between px-4 pb-1.5 pt-5">
          <span className="label-caps">Projects</span>
          <button
            type="button"
            onClick={onAddProject}
            title="Add a project"
            aria-label="Add a project"
            className="grid h-5 w-5 place-items-center rounded-[5px] text-ink-3 transition hover:bg-hover hover:text-accent"
          >
            <Plus size={12} weight="bold" />
          </button>
        </div>
        <Section>
          {projects.length === 0 ? (
            <button
              type="button"
              onClick={onAddProject}
              className="w-full rounded-[8px] border border-dashed border-line px-2 py-2 text-left text-[12px] text-ink-3 transition hover:border-line-strong hover:text-ink-2"
            >
              Add your first project
            </button>
          ) : (
            projects.map(({ name, count }) =>
              row(`project-${name}`, {
                icon: <FolderSimple size={15} weight="bold" />,
                label: name,
                count,
                active: is((f) => f.kind === 'project' && f.name === name),
                onClick: () => onFilter({ kind: 'project', name }),
                // An empty project exists only as a remembered name, so it is
                // the only kind that can actually be got rid of from here.
                onRemove: count === 0 ? () => onRemoveProject(name) : undefined,
                removeLabel: `Remove the empty project ${name}`,
              }),
            )
          )}
        </Section>

        {categoryCounts.size > 0 && (
          <>
            <Heading>Login types</Heading>
            <Section>
              {categories
                .filter((category) => (categoryCounts.get(category.id) ?? 0) > 0)
                .map((category) => {
                  const Icon = CATEGORY_ICON[category.icon] ?? Key;
                  return row(`category-${category.id}`, {
                    icon: <Icon size={15} weight="bold" />,
                    label: category.label,
                    count: categoryCounts.get(category.id) ?? 0,
                    active: is((f) => f.kind === 'category' && f.id === category.id),
                    onClick: () => onFilter({ kind: 'category', id: category.id }),
                  });
                })}
            </Section>
          </>
        )}

        {/* A list of entity names told you nothing you could act on: the same
            names are already on every row in the list. The rail's spare space
            now previews spend instead, and opens the full page. */}
        <Heading>Spend</Heading>
        <div className="px-3 pb-1">
          <SpendChart items={items} onOpen={() => onView('spend')} />
        </div>
        <Section>
          {row('spend', {
            icon: <ChartLineUp size={15} weight="bold" />,
            label: 'Spend breakdown',
            active: view === 'spend',
            onClick: () => onView('spend'),
          })}
        </Section>

        <Heading>Tools</Heading>
        <Section>
          {row('health', {
            icon: <Pulse size={15} weight="bold" />,
            label: 'Security review',
            count: audit.fragile.length + audit.reused.length + audit.incomplete.length,
            active: view === 'health',
            onClick: () => onView('health'),
          })}
          {row('generator', {
            icon: <Sparkle size={15} weight="bold" />,
            label: 'Generator',
            active: view === 'generator',
            onClick: () => onView('generator'),
          })}
          {row('upload-file', {
            icon: <FileArrowUp size={15} weight="bold" />,
            label: 'Upload file',
            active: false,
            onClick: onUploadFile,
          })}
          {row('import', {
            icon: <FileXls size={15} weight="bold" />,
            label: 'Import sheet',
            active: false,
            onClick: onImport,
          })}
          {row('print-labels', {
            icon: <Printer size={15} weight="bold" />,
            label: 'Print asset labels',
            active: false,
            onClick: onPrintLabels,
          })}
        </Section>
      </div>

      {/* Health */}
      <div className="border-t border-line px-3 pt-3">
        <button
          type="button"
          onClick={() => onView('health')}
          className="sheen w-full rounded-[9px] border border-line bg-raised/60 p-3 text-left transition hover:border-line-strong"
        >
          <div className="flex items-baseline justify-between">
            <span className="label-caps">Vault health</span>
            <span className={`font-mono text-[14px] font-medium ${healthInk}`}>{audit.health}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-strong">
            <motion.div
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${audit.health}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className={`h-full rounded-full ${healthTone}`}
            />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-3">
            {audit.fragile.length} weak, {audit.reused.length} reused, {audit.incomplete.length} missing
          </p>
        </button>
      </div>

      {/* Who is using this */}
      <div className="p-3">
        <button
          type="button"
          onClick={onSwitchUser}
          title="Change who is using this browser"
          className="group flex w-full items-center gap-2.5 rounded-[9px] px-2 py-2 text-left transition hover:bg-hover"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 font-mono text-[11px] font-medium text-accent">
            {identity ? initialsOf(identity.name) : '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] leading-tight text-ink">
              {identity?.name ?? 'Not set'}
            </span>
            <span className="block truncate text-[11px] leading-tight text-ink-3">
              {identity?.email ?? 'Tap to set'}
            </span>
          </span>
          <SignOut
            size={13}
            weight="bold"
            className="shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100"
          />
        </button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------- pieces ---- */

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="label-caps px-4 pb-1.5 pt-5">{children}</p>;
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="space-y-px px-2">{children}</div>;
}

type RowProps = {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** Adds a discard control, revealed on hover. Absent leaves the row fixed. */
  onRemove?: () => void;
  removeLabel?: string;
  reduce: boolean;
};

function Row({ icon, label, count, active, onClick, onRemove, removeLabel, reduce }: RowProps) {
  return (
    // The discard control cannot live inside the row's button — nesting one
    // button in another is invalid and the inner click never arrives — so the
    // two sit side by side and this wrapper carries the hover group.
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        className={`relative flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left text-[13px] transition-colors
          ${active ? 'text-ink' : 'text-ink-2 hover:bg-hover/50 hover:text-ink'}`}
      >
        {/* The lit pill slides between rows rather than blinking, so the eye can
            follow where the selection went. */}
        {active && (
          <motion.span
            layoutId={reduce ? undefined : 'nav-active'}
            transition={{ type: 'spring', stiffness: 520, damping: 42 }}
            className="absolute inset-0 -z-10 rounded-[8px] border border-line bg-hover"
          />
        )}
        <span className={active ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span
            className={`shrink-0 font-mono text-[11px] tabular-nums transition-opacity
              ${active ? 'text-ink-2' : 'text-ink-3'}
              ${onRemove ? 'group-hover:opacity-0' : ''}`}
          >
            {count}
          </span>
        )}
      </button>

      {/* Takes the count's place on hover. A removable row is always at zero,
          so nothing readable is being covered up. */}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={removeLabel ?? 'Remove'}
          aria-label={removeLabel ?? 'Remove'}
          className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-[5px] text-ink-3 opacity-0 transition hover:bg-hover hover:text-weak focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X size={11} weight="bold" />
        </button>
      )}
    </div>
  );
}
