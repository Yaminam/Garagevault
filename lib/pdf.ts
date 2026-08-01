/**
 * PDF reading for the billing scanner.
 *
 * Most invoices, from Stripe, Anthropic, Supabase and the rest, are generated
 * documents with real embedded text. Extracting that text is exact and instant.
 * Running OCR over them instead would be slower and strictly less accurate,
 * since OCR can only ever guess at what the file already states.
 *
 * So: read the text layer first, and only rasterise and hand pages to Tesseract
 * when a PDF turns out to be a scan of paper with no text in it.
 *
 * The worker is self-hosted from `/pdf` like everything else, so nothing is
 * fetched from a CDN and the file never leaves the tab.
 */

/** Below this many characters a page is treated as a scan rather than text. */
const TEXT_THRESHOLD = 40;

/** Rendering scale for the OCR fallback. 2x is enough for 300dpi-ish output. */
const RASTER_SCALE = 2;

/** Pages beyond this are ignored: the total is on the first page or two. */
const MAX_PAGES = 3;

type PdfModule = typeof import('pdfjs-dist');

let cached: PdfModule | null = null;

/** Self-hosted worker. Kept in `public/pdf` so nothing loads from a CDN. */
const WORKER_URL = '/pdf/pdf.worker.min.mjs';

async function loadPdfjs(): Promise<PdfModule> {
  if (cached) return cached;
  const pdfjs = await import('pdfjs-dist');
  // A last-resort path for browsers that reject module workers below.
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
  cached = pdfjs;
  return pdfjs;
}

/**
 * Build a worker for one document.
 *
 * Given only a `workerSrc` string, pdf.js reaches its fallback path and does
 * `import(workerSrc)`. Webpack sees a dynamic import of a variable it cannot
 * trace, rewrites it, and the fetch fails with "Setting up fake worker failed".
 * Constructing the Worker here keeps it out of the bundler's module graph.
 *
 * One per document rather than a shared port, because destroying a loading task
 * can terminate the worker it was given, which would silently break the second
 * scan of a session.
 */
function makeWorker(pdfjs: PdfModule): { worker?: unknown; dispose: () => void } {
  try {
    const port = new Worker(WORKER_URL, { type: 'module' });
    // pdfjs-dist ships `port?: null` in its declaration, which contradicts its
    // own documented use. The runtime accepts a real port.
    const worker = new pdfjs.PDFWorker({ port } as unknown as ConstructorParameters<
      PdfModule['PDFWorker']
    >[0]);
    return {
      worker,
      dispose: () => {
        try {
          worker.destroy();
        } catch {
          /* already gone */
        }
        port.terminate();
      },
    };
  } catch {
    // Module workers unsupported: fall back to the workerSrc path set above.
    return { dispose: () => {} };
  }
}

export const isPdf = (file: File | Blob) =>
  file.type === 'application/pdf' ||
  ('name' in file && typeof file.name === 'string' && /\.pdf$/i.test(file.name));

export type PdfRead = {
  /** Text pulled from the embedded text layer. Empty for a scanned PDF. */
  text: string;
  /** Page images to OCR, present only when the text layer was thin. */
  images: Blob[];
  pages: number;
};

/**
 * Read a PDF. Returns embedded text when there is any, otherwise page images
 * for the caller to OCR.
 */
export async function readPdf(
  file: File | Blob,
  onProgress?: (stage: string, ratio: number) => void,
): Promise<PdfRead> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const { worker, dispose } = makeWorker(pdfjs);

  try {
    return await readWith(pdfjs, data, worker, onProgress);
  } finally {
    dispose();
  }
}

async function readWith(
  pdfjs: PdfModule,
  data: Uint8Array,
  worker: unknown,
  onProgress?: (stage: string, ratio: number) => void,
): Promise<PdfRead> {
  // Destroying the loading task is what releases resources; the document proxy
  // itself no longer exposes that in pdf.js 6.
  const loadingTask = pdfjs.getDocument(
    worker ? ({ data, worker } as Parameters<PdfModule['getDocument']>[0]) : { data },
  );
  const doc = await loadingTask.promise;
  const pageCount = Math.min(doc.numPages, MAX_PAGES);

  let text = '';
  for (let n = 1; n <= pageCount; n++) {
    onProgress?.('reading pdf text', n / pageCount);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    // Items carry no line breaks, so rebuild them from vertical position.
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5] as number | undefined;
      if (lastY != null && y != null && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith('\n')) text += ' ';
      text += item.str;
      if (y != null) lastY = y;
    }
    text += '\n';
  }

  if (text.replace(/\s/g, '').length >= TEXT_THRESHOLD) {
    const pages = doc.numPages;
    await loadingTask.destroy();
    return { text: text.trim(), images: [], pages };
  }

  // No usable text layer, so this is a scan. Rasterise for OCR.
  const images: Blob[] = [];
  for (let n = 1; n <= pageCount; n++) {
    onProgress?.('rendering page', n / pageCount);
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: RASTER_SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render PDF pages.');

    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (blob) images.push(blob);
  }

  const total = doc.numPages;
  await loadingTask.destroy();
  return { text: '', images, pages: total };
}
