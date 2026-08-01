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
  serial: string | null;
  assignee: string | null;
  /** The full asset record, so a scan returns the details without the vault. */
  qr: string;
};

/**
 * The physical label. Sized for a 50 x 25mm thermal label, the common cheap
 * roll, and always black on white regardless of the app theme because that is
 * what phone cameras and label printers expect.
 */
export function AssetLabel({ data }: { data: LabelData }) {
  return (
    <div className="flex h-[25mm] w-[50mm] gap-[2mm] overflow-hidden rounded-[1mm] border border-black/15 bg-white p-[2mm] text-black">
      <div className="flex w-[19mm] shrink-0 items-center">
        <QrCode value={data.qr} className="h-[19mm] w-[19mm]" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-[0.5mm]">
        <div className="min-w-0">
          <p className="truncate text-[2.6mm] font-semibold leading-tight">{data.title}</p>
          {data.assignee && (
            <p className="truncate text-[2mm] leading-tight opacity-65">{data.assignee}</p>
          )}
        </div>

        <div className="min-w-0">
          <p className="truncate font-mono text-[3mm] font-semibold leading-none tracking-tight">
            {data.tag}
          </p>
          {data.serial && (
            <p className="mt-[0.8mm] truncate font-mono text-[1.9mm] leading-none opacity-60">
              {data.serial}
            </p>
          )}
        </div>

        <p className="text-[1.7mm] uppercase tracking-wider opacity-40">Garage Collective</p>
      </div>
    </div>
  );
}
