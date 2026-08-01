'use client';

import { CaretRight, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { VERDICT_LABEL, scorePassword } from '@/lib/audit.ts';
import type { VaultItem } from '@/lib/types.ts';
import { useVault } from './vault-context.tsx';
import { Monogram } from './primitives.tsx';

export function HealthPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { audit, items } = useVault();

  const tone = audit.health >= 75 ? 'text-strong' : audit.health >= 45 ? 'text-fair' : 'text-weak';
  const barTone = audit.health >= 75 ? 'bg-strong' : audit.health >= 45 ? 'bg-fair' : 'bg-weak';

  const measures = [
    { label: 'Weak or critical', value: audit.fragile.length },
    { label: 'Shared across accounts', value: audit.reused.reduce((n, g) => n + g.items.length, 0) },
    { label: 'Missing a password', value: audit.incomplete.length },
    { label: 'No second factor', value: audit.noTwoFactor.length },
  ];

  const clean =
    audit.fragile.length === 0 && audit.reused.length === 0 && audit.incomplete.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[840px] px-5 py-6 md:px-8 md:py-8">
        <h1 className="text-[21px] font-semibold tracking-[-0.015em] text-ink">Security review</h1>
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">
          Scored across {items.length} entries. Open any row to change it, or rotate a password with
          the generator.
        </p>

        {/* Score plus measures, asymmetric so the number carries the weight. */}
        <section className="mt-6 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line md:grid-cols-[minmax(0,220px)_1fr]">
          <div className="bg-panel p-5">
            <p className="label-caps">Health</p>
            <p className={`mt-2 font-mono text-[44px] font-medium leading-none tracking-tight ${tone}`}>
              {audit.health}
            </p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-line-strong">
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${audit.health}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px bg-line">
            {measures.map((measure) => (
              <div key={measure.label} className="bg-panel px-5 py-4">
                <p className="font-mono text-[20px] font-medium leading-none text-ink">{measure.value}</p>
                <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{measure.label}</p>
              </div>
            ))}
          </div>
        </section>

        {clean ? (
          <div className="mt-8 flex items-start gap-3 rounded-[12px] border border-strong/25 bg-strong/[0.06] p-4">
            <ShieldCheck size={17} weight="bold" className="mt-px shrink-0 text-strong" />
            <div>
              <p className="text-[13.5px] font-medium text-ink">Nothing outstanding</p>
              <p className="mt-1 text-[12.5px] text-ink-2">
                No weak, shared, or missing passwords in this snapshot.
              </p>
            </div>
          </div>
        ) : null}

        {audit.reused.length > 0 && (
          <Group
            title="Reused passwords"
            note="One breach exposes every account in the group."
          >
            {audit.reused.map((group, index) => (
              <div key={index} className="border-b border-line last:border-b-0">
                <p className="px-4 pb-1 pt-3 text-[11.5px] text-ink-3">
                  Shared by {group.items.length} accounts
                </p>
                {group.items.map((item) => (
                  <ItemRow key={item.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            ))}
          </Group>
        )}

        {audit.fragile.length > 0 && (
          <Group title="Weak passwords" note="Short, predictable, or built from a known word.">
            {audit.fragile.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={onOpen} showVerdict />
            ))}
          </Group>
        )}

        {audit.incomplete.length > 0 && (
          <Group title="Incomplete rows" note="The sheet has no usable password for these.">
            {audit.incomplete.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={onOpen} />
            ))}
          </Group>
        )}

        {audit.noTwoFactor.length > 0 && (
          <Group
            title="No second factor recorded"
            note="Either 2FA is off, or the sheet never captured it."
          >
            {audit.noTwoFactor.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={onOpen} />
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
        <p className="text-[12px] text-ink-3">{note}</p>
      </div>
      <div className="mt-3 overflow-hidden rounded-[12px] border border-line bg-panel">{children}</div>
    </section>
  );
}

function ItemRow({
  item,
  onOpen,
  showVerdict = false,
}: {
  item: VaultItem;
  onOpen: (id: string) => void;
  showVerdict?: boolean;
}) {
  const score = item.password ? scorePassword(item.password) : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hover"
    >
      <Monogram label={item.title} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{item.title}</span>
        <span className="block truncate text-[11.5px] text-ink-3">
          {item.username ?? item.entity}
        </span>
      </span>
      {showVerdict && score && (
        <span className={`shrink-0 text-[11.5px] ${score.verdict === 'fair' ? 'text-fair' : 'text-weak'}`}>
          {VERDICT_LABEL[score.verdict]}
        </span>
      )}
      <CaretRight size={13} weight="bold" className="shrink-0 text-ink-3" />
    </button>
  );
}
