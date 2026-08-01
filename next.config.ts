import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Supabase is the only host the page is allowed to talk to. Deriving the origin
 * from the configured URL keeps the policy tight: if the project changes, the
 * allowance follows it rather than degrading to a wildcard.
 */
function supabaseOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Everything sensitive is decrypted in the browser, so the main risk is a
  // script pulling plaintext back out. Lock the page down accordingly.
  async headers() {
    const supabase = supabaseOrigin();
    // Dev also needs the websocket for hot reload.
    const connect = ["'self'", supabase, isDev ? 'ws: wss:' : ''].filter(Boolean).join(' ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next injects inline bootstrap scripts in dev and prod.
              // 'wasm-unsafe-eval' is what lets the self-hosted Tesseract core
              // instantiate; it permits WebAssembly without permitting eval.
              `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
              // The OCR worker is same-origin, but Tesseract wraps it in a blob.
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              `connect-src ${connect}`,
              "form-action 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join('; '),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Keep the vault out of search engines and archives if ever hosted.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
