'use client';

/**
 * Where an asset's QR code actually goes.
 *
 * No vault, no unlock, no network request: everything shown here rode along
 * in the URL fragment the label's QR encodes, which browsers never send to a
 * server. That is also why this can only ever show what was already printed
 * in the clear on the physical label — nothing secret is or could be routed
 * through this page.
 */

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Barcode, WarningOctagon } from '@phosphor-icons/react/dist/ssr';
import { decodeAssetQrFragment } from '@/lib/qr.ts';

const ROWS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'serial', label: 'Serial' },
  { key: 'status', label: 'Status' },
  { key: 'holder', label: 'Holder' },
  { key: 'department', label: 'Department' },
  { key: 'location', label: 'Location' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'warranty', label: 'Warranty until' },
  { key: 'received', label: 'Received' },
];

export function AssetQrView() {
  const reduce = useReducedMotion();
  // Missing rather than empty until the effect below runs, so the fragment is
  // never assumed absent just because this render happened before hydration.
  const [data, setData] = useState<Record<string, string> | null | undefined>(undefined);

  useEffect(() => {
    setData(decodeAssetQrFragment(window.location.hash.replace(/^#/, '')));
  }, []);

  return (
    <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-6 py-16">
      <div className="ambient pointer-events-none absolute inset-0" aria-hidden />
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="lift relative w-full max-w-[480px] overflow-hidden rounded-[12px] border border-line bg-panel"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-accent/35 bg-accent/12 text-accent">
            <Barcode size={15} weight="bold" />
          </span>
          <span className="h-5 w-px bg-line-strong" aria-hidden />
          <span className="font-mono text-[12px] text-ink-3">garage asset</span>
        </div>

        <div className="px-6 py-7">
          {data === undefined && (
            <p className="label-caps animate-pulse py-8 text-center">Reading the tag</p>
          )}

          {data === null && (
            <>
              <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-weak/30 bg-weak/10 text-weak">
                <WarningOctagon size={19} weight="bold" />
              </span>
              <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">
                Not an asset tag
              </h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
                This link is missing the data it should carry after the # symbol. Scan the QR
                directly rather than typing the link by hand.
              </p>
            </>
          )}

          {data && (
            <>
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">
                {data.name ?? 'Untitled asset'}
              </h1>
              {data.tag && (
                <p className="mt-1 font-mono text-[13px] font-medium tracking-tight text-accent">
                  {data.tag}
                </p>
              )}

              <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
                {ROWS.filter((row) => data[row.key]).map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                  >
                    <span className="w-[38%] shrink-0 truncate font-mono text-[11.5px] text-ink-3">
                      {row.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {data[row.key]}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-5 text-[11.5px] leading-relaxed text-ink-3">
                Everything above was already printed on the physical label. Nothing was fetched
                from a server to show it.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </main>
  );
}
