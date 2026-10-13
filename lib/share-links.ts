/**
 * Link URLs for shared content. bagged-app.com is meant to serve these (it's
 * what app.json's iOS associatedDomains / Android intentFilters already
 * declare, so a device with Bagged installed opens the app directly with no
 * rebuild needed) — but as of writing, that domain's DNS points at separate
 * hosting, not the Vercel project this repo deploys to, so /p/* 404s there
 * today. Get bagged-app.com pointed at Vercel (add it as a domain in the
 * Vercel project, then update its DNS records) before shipping this to real
 * users; don't swap this back to bagged.vercel.app in the meantime, that's
 * an internal address only.
 */
export const SHARE_LINK_HOST = 'https://bagged-app.com';

/** Deep link to a specific product's page, for shareables and the "buy it here" style flows. */
export function productShareUrl(descriptionKey: string | null | undefined): string | null {
  const key = String(descriptionKey ?? '').trim();
  if (!key) return null;
  return `${SHARE_LINK_HOST}/p/${encodeURIComponent(key)}`;
}

/** Short, human-friendly form for display on a card or in a caption (no scheme, no encoding). */
export function productShareUrlDisplay(descriptionKey: string | null | undefined): string | null {
  const key = String(descriptionKey ?? '').trim();
  if (!key) return null;
  return `bagged-app.com/p/${key}`;
}
