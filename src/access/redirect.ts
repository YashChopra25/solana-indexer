/**
 * Only a path on this site, so the form cannot be used to bounce people
 * elsewhere. Parsed the way a browser would, because `/\evil.com` and paths
 * with control characters look local as strings but browsers leave the site.
 */
export function safeNext(next: string): string {
  const fallback = '/admin';
  if (!next.startsWith('/') || /[\\\u0000-\u001f]/.test(next)) return fallback;

  try {
    const base = 'http://this.site';
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
