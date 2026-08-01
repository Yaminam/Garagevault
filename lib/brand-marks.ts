/**
 * Brand marks for vault entries.
 *
 * A credential list is scanned, not read. A recognisable silhouette lands
 * before the title does, which is the whole reason to carry logos at all.
 *
 * Three constraints shaped this:
 *
 * 1. **Bundled, never fetched.** The obvious implementation is a favicon
 *    service or a logo CDN. Both are disqualified: the CSP allows images from
 *    `'self' data: blob:` only, and more importantly, asking a third party for
 *    `stripe.com`'s icon tells that third party this vault holds a Stripe
 *    account. A zero-knowledge vault that leaks its own index over the network
 *    is not zero-knowledge. Path data ships in the bundle and nothing is
 *    requested at runtime.
 *
 * 2. **Monochrome.** Simple Icons publishes an official hex per brand, and
 *    using them is wrong here twice over. Vercel, Notion, X, Resend and
 *    Replicate are all `#000000`, so brand colour would erase them against the
 *    dark theme; and fifty saturated logos in a dense list reads as confetti,
 *    which breaks the rule the rest of this app follows, that colour marks the
 *    active thing and nothing else. The mark inherits `currentColor` and picks
 *    up the same ink and accent treatment as every other tile.
 *
 * 3. **Silent fallback.** Some brands are absent from Simple Icons for
 *    trademark reasons, OpenAI, Slack, AWS, LinkedIn and Microsoft among them.
 *    Those entries keep the two-letter monogram, which is why the monogram
 *    stays the default rather than the error case.
 */

import {
  siAnthropic,
  siApple,
  siAtlassian,
  siBitbucket,
  siCloudflare,
  siCloudinary,
  siDatadog,
  siDigitalocean,
  siDiscord,
  siDocker,
  siDropbox,
  siElevenlabs,
  siFigma,
  siFlydotio,
  siGithub,
  siGitlab,
  siGodaddy,
  siGoogle,
  siGooglecloud,
  siHetzner,
  siHubspot,
  siHuggingface,
  siInstagram,
  siLinear,
  siMailchimp,
  siMeta,
  siMongodb,
  siNamecheap,
  siNetlify,
  siNotion,
  siNpm,
  siPaypal,
  siPerplexity,
  siPostgresql,
  siRailway,
  siRazorpay,
  siReddit,
  siRedis,
  siReplicate,
  siRender,
  siResend,
  siSentry,
  siShopify,
  siStripe,
  siSupabase,
  siTelegram,
  siVercel,
  siWhatsapp,
  siWordpress,
  siX,
  siYoutube,
  siZoho,
  siZoom,
} from 'simple-icons';

export type BrandMark = {
  /** Brand name, used for the accessible label. */
  title: string;
  /** A single SVG path, drawn in a 24x24 viewBox. */
  path: string;
};

type SimpleIcon = { title: string; path: string };

/**
 * Ordered, because the first hit wins and some patterns are subsets of others:
 * `googlecloud` has to be tested before `google`, and `github` before `git`.
 * Patterns are anchored on word boundaries so `x` matches the company and not
 * the letter in every other word.
 */
const RULES: [RegExp, SimpleIcon][] = [
  // Infrastructure and data
  [/\bsupabase\b/, siSupabase],
  [/\bvercel\b/, siVercel],
  [/\bnetlify\b/, siNetlify],
  [/\bcloudflare\b/, siCloudflare],
  [/\brailway\b/, siRailway],
  [/\brender\.com\b|\brender\b/, siRender],
  [/\bfly\.io\b|\bflydotio\b/, siFlydotio],
  [/\bhetzner\b/, siHetzner],
  [/\bdigitalocean\b|\bdigital ocean\b/, siDigitalocean],
  [/\bgoogle ?cloud\b|\bgcp\b/, siGooglecloud],
  [/\bmongodb\b|\bmongo\b/, siMongodb],
  [/\bpostgres(ql)?\b/, siPostgresql],
  [/\bredis\b|\bupstash\b/, siRedis],
  [/\bdocker\b/, siDocker],
  [/\bcloudinary\b/, siCloudinary],
  [/\bsentry\b/, siSentry],
  [/\bdatadog\b/, siDatadog],

  // AI
  [/\banthropic\b|\bclaude\b/, siAnthropic],
  [/\bhugging ?face\b/, siHuggingface],
  [/\breplicate\b/, siReplicate],
  [/\belevenlabs\b|\beleven ?labs\b/, siElevenlabs],
  [/\bperplexity\b/, siPerplexity],

  // Code hosting and packages
  [/\bgithub\b/, siGithub],
  [/\bgitlab\b/, siGitlab],
  [/\bbitbucket\b/, siBitbucket],
  [/\bnpm(js)?\b/, siNpm],
  [/\blinear\.app\b|\blinear\b/, siLinear],
  [/\batlassian\b|\bjira\b|\bconfluence\b/, siAtlassian],

  // Payments and commerce
  [/\bstripe\b/, siStripe],
  [/\bpaypal\b/, siPaypal],
  [/\brazorpay\b/, siRazorpay],
  [/\bshopify\b/, siShopify],

  // Communication and mail
  [/\bresend\b/, siResend],
  [/\bmailchimp\b/, siMailchimp],
  [/\bhubspot\b/, siHubspot],
  [/\bzoho\b/, siZoho],
  [/\bdiscord\b/, siDiscord],
  [/\btelegram\b/, siTelegram],
  [/\bwhatsapp\b/, siWhatsapp],
  [/\bzoom\b/, siZoom],

  // Domains and hosting admin
  [/\bgodaddy\b/, siGodaddy],
  [/\bnamecheap\b/, siNamecheap],
  [/\bwordpress\b/, siWordpress],

  // Workspace
  [/\bnotion\b/, siNotion],
  [/\bfigma\b/, siFigma],
  [/\bdropbox\b/, siDropbox],

  // Social. `google` sits late so the cloud rule above wins first.
  [/\binstagram\b/, siInstagram],
  [/\byoutube\b/, siYoutube],
  [/\breddit\b/, siReddit],
  [/\bmeta\b|\bfacebook\b/, siMeta],
  [/\btwitter\b|\bx\.com\b/, siX],
  [/\bapple\b|\bicloud\b/, siApple],
  [/\bgoogle\b|\bgmail\b/, siGoogle],
];

/** The fields a brand can be recognised from, whatever kind of entry it is. */
export type BrandFields = {
  title?: string | null;
  url?: string | null;
  entity?: string | null;
  /** Billing rows name the service here rather than in the title. */
  vendor?: string | null;
};

/** Everything worth matching a brand against, lowercased. */
function haystack(fields: BrandFields): string {
  let host = '';
  if (fields.url) {
    try {
      // Bare domains are common in imported sheets and are not valid URLs.
      host = new URL(fields.url.includes('://') ? fields.url : `https://${fields.url}`).hostname;
    } catch {
      host = fields.url;
    }
  }
  // Underscores and hyphens become spaces so `\b` can see the words inside
  // `fly.io`, `x.com` and `google-cloud`.
  return [host, fields.title, fields.vendor, fields.entity]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

/** The brand mark for a set of fields, or `null` to fall back to the monogram. */
export function brandMarkFor(fields: BrandFields): BrandMark | null {
  const hay = haystack(fields);
  if (!hay.trim()) return null;

  for (const [pattern, icon] of RULES) {
    if (pattern.test(hay)) return { title: icon.title, path: icon.path };
  }
  return null;
}

/**
 * The same lookup, reading whichever fields the entry kind actually populates.
 *
 * This is the one to call from UI. An uploaded invoice arrives with its
 * service in `billing.vendor` and a title like "Invoice 4471", so matching on
 * the title alone would miss every bill; a login carries its service in the
 * URL. Routing both through here means a Supabase bill and a Supabase login
 * land on the same mark without either caller knowing why.
 */
export function brandMarkForItem(item: {
  title?: string | null;
  url?: string | null;
  entity?: string | null;
  billing?: { vendor?: string | null } | null;
}): BrandMark | null {
  return brandMarkFor({
    title: item.title,
    url: item.url,
    entity: item.entity,
    vendor: item.billing?.vendor ?? null,
  });
}
