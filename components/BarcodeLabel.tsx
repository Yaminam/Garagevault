'use client';

import { useMemo } from 'react';
import { encodeQr } from '@/lib/qr.ts';

/**
 * QR rendered as one path rather than a rect per module. A 69x69 code is nearly
 * five thousand rects otherwise, which is slow to lay out and bloats a print
 * job for no benefit.
 */
export function QrCode({
  value,
  className,
  quiet = 2,
}: {
  value: string;
  className?: string;
  /** Quiet zone in modules. The spec asks for 4; 2 is fine on a printed label. */
  quiet?: number;
}) {
  const path = useMemo(() => {
    if (!value) return null;
    try {
      const matrix = encodeQr(value);
      const parts: string[] = [];
      for (let row = 0; row < matrix.size; row++) {
        for (let col = 0; col < matrix.size; col++) {
          if (matrix.dark(row, col)) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
        }
      }
      return { d: parts.join(''), extent: matrix.size + quiet * 2 };
    } catch {
      return null;
    }
  }, [value, quiet]);

  if (!path) return null;

  return (
    <svg
      viewBox={`0 0 ${path.extent} ${path.extent}`}
      role="img"
      aria-label="Asset QR code"
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={path.extent} height={path.extent} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  );
}

export type LabelData = {
  tag: string;
  title: string;
  category: string | null;
  serial: string | null;
  assignee: string | null;
  department: string | null;
  /** The full asset record, so a scan returns the details without the vault. */
  qr: string;
};

/**
 * The physical label. Sized for a 70 x 35mm thermal label — a step up from
 * the common 50 x 25mm roll, since that size left no room for a category,
 * device name, serial and who has it all to appear in full rather than
 * clipped. Always black on white regardless of the app theme, since that is
 * what phone cameras and label printers expect.
 */
export function AssetLabel({ data }: { data: LabelData }) {
  return (
    <div className="flex h-[35mm] w-[70mm] gap-[3mm] overflow-hidden rounded-[1.5mm] border border-black/15 bg-white p-[3mm] text-black">
      <div className="flex w-[27mm] shrink-0 items-center">
        <QrCode value={data.qr} className="h-[27mm] w-[27mm]" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-[0.5mm]">
        <div className="min-w-0">
          {/* Category leads, the same way it does in the entry list: two of
              the same laptop model are one glance apart once the label says
              "Laptop" first rather than repeating the exact model. Wraps
              instead of clipping, since this is the only copy of the info
              once it walks out the door with the asset. */}
          <p className="line-clamp-1 text-[3.2mm] font-semibold leading-[1.15]">
            {data.category ?? data.title}
          </p>
          <p className="line-clamp-1 text-[2.4mm] leading-[1.15] opacity-65">{data.title}</p>
        </div>

        <div className="min-w-0">
          <p className="truncate font-mono text-[4.2mm] font-semibold leading-none tracking-tight">
            {data.tag}
          </p>
          {data.serial && (
            <p className="mt-[1mm] truncate font-mono text-[2.3mm] leading-none opacity-60">
              {data.serial}
            </p>
          )}
          {(data.assignee || data.department) && (
            <p className="mt-[0.6mm] line-clamp-1 text-[2.2mm] leading-none opacity-60">
              {[data.assignee, data.department].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <p className="text-[2.4mm] uppercase tracking-wider opacity-40">Garage Collective</p>
      </div>
    </div>
  );
}
