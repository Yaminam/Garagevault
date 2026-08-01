import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from '@/lib/theme.ts';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Garage Vault',
    template: '%s · Garage Vault',
  },
  description: 'Credentials, environments, billing and assets for the Garage AI stack.',
  applicationName: 'Garage Vault',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matches `--bg` in each palette, so the browser chrome on mobile continues
  // the canvas instead of drawing a seam above it.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08090b' },
    { media: '(prefers-color-scheme: light)', color: '#f1f1ef' },
  ],
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The init script rewrites `data-theme` before React hydrates, so the
    // server value and the client value legitimately differ on first pass.
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose: it has to win the race against first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
