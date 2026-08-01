/**
 * Copy the OCR and PDF worker assets out of node_modules into `public`.
 *
 *   npm run sync:workers
 *
 * These are self-hosted so nothing loads from a CDN, which means they are also
 * hand-copied, which means they drift the moment npm bumps either package. A
 * pdf.js main thread talking to a worker from a different minor version fails
 * in ways that look like a corrupt file, so this runs on postinstall.
 *
 * The Tesseract language data is not here: it is a one-off download from the
 * tessdata project rather than an npm artefact.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ASSETS: { from: string; to: string }[] = [
  // pdf.js
  { from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs', to: 'public/pdf/pdf.worker.min.mjs' },
  // Tesseract
  { from: 'node_modules/tesseract.js/dist/worker.min.js', to: 'public/ocr/worker.min.js' },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
    to: 'public/ocr/tesseract-core-simd-lstm.wasm',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    to: 'public/ocr/tesseract-core-simd-lstm.wasm.js',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
    to: 'public/ocr/tesseract-core-lstm.wasm',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
    to: 'public/ocr/tesseract-core-lstm.wasm.js',
  },
];

let copied = 0;
let missing = 0;

for (const asset of ASSETS) {
  const source = resolve(ROOT, asset.from);
  const target = resolve(ROOT, asset.to);

  if (!existsSync(source)) {
    console.warn(`  missing  ${asset.from}`);
    missing++;
    continue;
  }

  const stale =
    !existsSync(target) || statSync(source).size !== statSync(target).size;

  if (stale) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    console.log(`  updated  ${asset.to}`);
    copied++;
  }
}

const language = resolve(ROOT, 'public/ocr/eng.traineddata.gz');
if (!existsSync(language)) {
  console.warn(
    '\n  public/ocr/eng.traineddata.gz is missing. OCR will not work without it.\n' +
      '  Fetch it once with:\n' +
      '    curl -o public/ocr/eng.traineddata.gz \\\n' +
      '      https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz',
  );
}

console.log(
  copied === 0 && missing === 0
    ? 'Workers already up to date.'
    : `Workers synced: ${copied} updated, ${missing} missing.`,
);
