const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

function stripUrlQuery(u: string): string {
  const i = u.indexOf("?");
  return i === -1 ? u : u.slice(0, i);
}

function fileTitleFromCommonsFilePage(photoPageUrl: string): string | null {
  const m = photoPageUrl.match(/commons\.wikimedia\.org\/wiki\/File:([^#?]+)/i);
  if (!m?.[1]) return null;
  const name = decodeURIComponent(m[1]);
  return `File:${name}`;
}

/** Thumb layout: /wikipedia/commons/thumb/{a}/{b}/{filename}/{width}px-{filename} */
function fileTitleFromUploadWikimediaUrl(uploadUrl: string): string | null {
  try {
    const u = new URL(uploadUrl);
    if (!u.hostname.toLowerCase().endsWith(".wikimedia.org")) return null;
    const segs = u.pathname.split("/").filter(Boolean);
    const thumbIdx = segs.indexOf("thumb");
    if (thumbIdx >= 0 && segs.length >= thumbIdx + 4) {
      const fileSeg = segs[thumbIdx + 3];
      if (fileSeg && /\.(jpe?g|png|webp|svg)$/i.test(fileSeg)) return `File:${fileSeg}`;
    }
    const last = segs[segs.length - 1];
    if (last) {
      const px = last.match(/^(\d+)px-(.+\.(?:jpe?g|png|webp|svg))$/i);
      if (px?.[2]) return `File:${px[2]}`;
      if (/\.(jpe?g|png|webp|svg)$/i.test(last)) return `File:${last}`;
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Turns a guessed `upload.wikimedia.org` URL or a Commons `File:` page into the
 * canonical `imageinfo.url` from the MediaWiki API (fixes wrong hash segments from LLMs).
 */
export async function resolveCommonsDirectImageUrl(
  url: string,
  photoPageUrl?: string
): Promise<string | null> {
  const title =
    (photoPageUrl ? fileTitleFromCommonsFilePage(photoPageUrl) : null) ?? fileTitleFromUploadWikimediaUrl(url);
  if (!title) return null;

  const api = new URL(COMMONS_API);
  api.searchParams.set("action", "query");
  api.searchParams.set("format", "json");
  api.searchParams.set("titles", title);
  api.searchParams.set("prop", "imageinfo");
  api.searchParams.set("iiprop", "url");

  const res = await fetch(api.toString(), {
    headers: { "User-Agent": "TripPlanningApp/1.0 (hero-cover; +https://wikimedia.org)" },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const j = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; missing?: true; imageinfo?: Array<{ url?: string }> }
      >;
    };
  };
  const pages = j.query?.pages;
  if (!pages) return null;
  for (const p of Object.values(pages)) {
    if (p.missing === true) continue;
    const direct = p.imageinfo?.[0]?.url?.trim();
    if (direct && /^https:\/\//i.test(direct)) return stripUrlQuery(direct);
  }
  return null;
}
