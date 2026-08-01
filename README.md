# Garage Vault

Zero-knowledge credential, environment, billing and asset manager for the
Garage AI stack. Everything is encrypted and decrypted in the browser under a
master password that never leaves the tab. Supabase stores ciphertext and
nothing else.

## Open the vault

```bash
git clone https://github.com/Garage-Collective-AI/garagevault.git
cd garagevault

npm install
cp .env.example .env.local   # fill in the two NEXT_PUBLIC_SUPABASE_* values
npm run db:push              # apply migrations to a linked Supabase project

npm run dev                  # http://localhost:3000
```

Then enter the **master password** at the unlock screen. It is derived into the
encryption key in your browser and is never sent anywhere.

The master password is **deliberately not in this file**, and should not be
added to it. It decrypts every entry in the vault, so committing it beside the
code that reads it would defeat the entire design, private repository or not.
It lives in `VAULT-ACCESS.local.md`, which is gitignored and stays on your
machine, and it belongs in a real password manager as the durable copy.

**First run, no vault yet?** The unlock screen becomes a *create* screen, and
whatever you type there becomes the master password. Write it down before
continuing. There is no recovery: lose it and the rows cannot be opened by
anyone, including whoever owns the database.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router | Server Components by default, one deploy target |
| UI | React 19, TypeScript 5.9 | |
| Styling | Tailwind CSS 4 | Tokens declared with `@theme inline`, so themes swap at runtime |
| Motion | Motion (`motion/react`) | Spring physics, honours `prefers-reduced-motion` |
| Icons | Phosphor | One family throughout, `weight="bold"` for controls |
| Brand marks | Simple Icons | Path data bundled, never fetched. See below |
| Fonts | Geist Sans and Geist Mono, via `next/font` | Self-hosted, no external requests |
| Database | Supabase Postgres | Row-level security, migrations in `supabase/` |
| File storage | Supabase Storage | Holds AES-GCM ciphertext under random object names |
| Crypto | WebCrypto | PBKDF2-SHA256 and AES-256-GCM, no crypto dependencies |
| PDF | `pdfjs-dist` | Text layer extraction, self-hosted worker |
| OCR | `tesseract.js` | Fallback for scans and photos, WASM core served locally |
| Spreadsheets | Hand-written `.xlsx` reader | See below |
| Hosting | Vercel | |

Two deliberate non-choices. The `.xlsx` reader in `tools/xlsx.ts` and
`lib/xlsx-core.ts` is written from scratch on `DecompressionStream` rather than
pulling in a spreadsheet library, and the brand marks ship as bundled path data
rather than being fetched from a logo CDN. This repository handles credentials,
so the smaller the supply chain that touches plaintext, the better, and asking
a third party for `stripe.com`'s icon would tell that third party the vault
holds a Stripe account.

## How the encryption works

```
master password + per-vault salt  --PBKDF2-SHA256 x600k-->  256-bit AES key
each entry                        --AES-256-GCM---------->  { iv, ciphertext }
each attached file                --AES-256-GCM---------->  opaque blob
```

The key is derived per session, held in memory, and dropped when the vault
locks. Postgres stores only `iv` and `ciphertext`. Titles, usernames, URLs and
owner emails are all inside the ciphertext, so the database leaks no metadata
either.

### Why the anon key being public is fine

The anon key ships inside the browser bundle, so anyone using the app can read
it. It is not what protects the data. Someone holding it can fetch rows and get
back unreadable blobs. Confidentiality comes from the master password.

What that key *does* allow is deletion and tampering. For an internal tool on a
private URL that is usually an acceptable trade. To close it, turn on Supabase
Auth and change `to anon, authenticated` to `to authenticated` on the insert,
update and delete policies in the migrations.

The `service_role` key is different: it bypasses row-level security entirely.
It belongs only in `.env.local` and is used only by the scripts in `tools/`.
Never prefix it with `NEXT_PUBLIC_`.

## What it holds

**Logins** are the classic username, password, URL, 2FA set, with a password
strength verdict on every row.

**Environments** are sets of `KEY=value` pairs. Picking a provider pre-fills
the exact variable names that service expects, so an entry never ends up half
populated with an invented name. `lib/env-templates.ts` covers Supabase,
OpenAI, Anthropic, Vercel, Resend, Cloudflare, Fal, Google Cloud and Stripe.
Values are masked based on whether the key name looks secret: `SUPABASE_URL`
stays visible, `SERVICE_ROLE_KEY` does not.

**Billing** entries carry vendor, amount, currency, cycle and renewal date, and
can hold the invoice PDF itself as an encrypted attachment.

**Assets** carry a tag, serial and holder, and can print barcode labels.

**People** and **Organisation** hold employee records and company details.

Every entry carries a **project** and an **owner**. The owner is the point: a
secret nobody is named against is a secret nobody rotates when someone leaves.

## Spend

A dedicated page reads the billing entries four ways: per month, cumulative, by
vendor and by project. Two rules are applied and both are stated in the UI
rather than done quietly.

**Mixed currencies are never summed.** Adding INR to USD produces a figure that
is wrong in every currency, so each currency gets its own complete set of
figures and a switch between them.

**One-off giants are excluded.** A bill drops out when it is at least ten times
the median of the other bills in its currency. A single capital invoice an
order of magnitude above the rest flattens every other month into a hairline,
which is the one thing a spend chart must not do.

## Attachments

Invoices are encrypted in the tab before upload and stored under random object
names, so a listing of the bucket gives away no vendor, date or ordering. The
real filename lives inside the item's encrypted payload.

Uploading a PDF as it stands would undo the point of the vault: an invoice
states the vendor, the amount, the address and often the bank details, and the
anon key that reaches the bucket ships in the browser bundle. The bucket is
private as well, but that is the second line of defence, not the first.

The cost is that Supabase can no longer preview or thumbnail a file, and every
view is a download and a decrypt. That is the correct trade here.

## Getting data in

| Route | What it takes |
|---|---|
| Tools, then **Upload file** | `.env`, text, Word, PDF or a photo. Any `KEY=value` lines are pulled out, with OCR for scans |
| Tools, then **Import sheet** | `.xlsx`, read and encrypted entirely in the tab |
| Bill detail, then **Attach the invoice** | One PDF or image against one bill |
| `npm run import:env` | One `.env` file, from a terminal |
| `npm run attach:invoices` | A whole folder of invoices, matched to existing bills |
| `npm run seed` | The master tracker spreadsheet |

Every route skips what is already present, so running any of them twice is
safe. Nothing is ever uploaded to a server for processing: files are read,
parsed and encrypted in the browser.

`npm run attach:invoices` is dry by default and prints the pairing it worked
out before changing anything, because a filename is not a foreign key and a
confidently wrong pairing files a bill under the wrong vendor where nobody will
notice. Add `--apply` once the plan looks right.

## Sharing

"Share securely" creates a one-time link. The payload is encrypted with its own
random key, not your master password, so handing someone a link exposes that
one entry and nothing else.

```
https://your-host/s/<row id>#<decryption key>
```

The key sits after the `#`. Browsers never transmit a fragment, so the server
cannot read the share even in principle, and a link recovered from a database
dump is useless on its own. Opening a share consumes a view through the
`claim_share` function, which deletes the row once the budget is spent. Expiry
is capped at 30 days by a database constraint.

## Security behaviour in the app

- Auto-locks after 5 minutes idle, with a countdown in the top bar.
- Revealed secrets re-hide after 20 seconds.
- Copied secrets are cleared from the clipboard after 30 seconds.
- The whole surface blurs when the tab loses focus, so a screen share or a
  passer-by catches nothing. Toggle in the top bar.
- A strict CSP allows connections only to the configured Supabase origin, so
  there is no path to exfiltrate decrypted plaintext.
- Decrypted attachments live in a `blob:` URL that is revoked after 30 seconds.

## Theming

Day and night, switched from the header. Both palettes are raw CSS variables
swapped on `:root[data-theme]` and mapped through Tailwind's `@theme inline`,
so utilities compile to `var()` references and follow the theme at runtime.

Elevation keeps its direction in both: `raised` is always the step toward the
viewer, so it goes lighter from `#08090b` at night and from `#f1f1ef` by day.
Inks, the accent and the health colours are deepened for the light theme to
clear WCAG AA, because `#ff7a2f` on white is 2.4:1 and unreadable as text.

## Layout

```
app/            routes: the vault, and /s/[id] for shared links
components/     UI. VaultApp owns the session, Workbench the three panes
lib/            crypto, repository, audit, spend, attachments, env templates
tools/          importers, seeding and maintenance scripts
supabase/       migrations
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run seed` | Import the master tracker spreadsheet |
| `npm run import:env` | Import one `.env` file as an environment entry |
| `npm run attach:invoices` | Attach a folder of invoices to existing bills |
| `npm run rekey` | Change the master password, re-encrypting every row |

`seed`, `rekey`, `import:env` and `attach:invoices` prompt for the master
password with hidden input, so they need a real terminal. They will not work
through an editor's command runner, which has no TTY and hands the prompt an
immediate end-of-input.

## Changing the master password

`npm run rekey` re-encrypts every row under the new key and swaps the metadata
last, so an interrupted run leaves the old password working and can simply be
run again. Row ids and timestamps survive, so nothing breaks.

## Keyboard

| | |
|---|---|
| `Ctrl K` or `/` | Search |
| `Ctrl N` | New entry |
| `Ctrl L` | Lock |
| `Up` `Down` | Move through the list |
| `Esc` | Clear search, or close a dialog |

## Backups

The free Supabase plan has no backups, and there is no recovery for the master
password. Those are two independent single points of failure. Keep the original
invoices and spreadsheets somewhere outside the vault, and treat this as a
convenient index rather than the only copy of the paperwork.
