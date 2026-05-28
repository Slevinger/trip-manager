/** Same-origin proxy for hosts that block hotlinking; allowlist matches `hero-image-proxy` API route. */
export function heroCoverImageSrc(originalUrl: string | undefined | null): string {
  const url = originalUrl?.trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return url;
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".wikimedia.org")) {
      return `/api/trip/hero-image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }
  return url;
}
