import { NextResponse } from "next/server";

const TIMEOUT_MS = 6_000;
const MAX_HTML_BYTES = 200_000; // read only the first ~200 KB (enough for <head>)

function extractMetaContent(html: string, property: string): string | null {
  // matches <meta property="og:image" content="..."> or name/content variants
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  let m = re.exec(html);
  if (m) return m[1];
  // also try reversed attribute order: content first, then property
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i"
  );
  m = re2.exec(html);
  return m ? m[1] : null;
}

function faviconFallback(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw?.trim()) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ error: "only http/https" }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; TripPlannerBot/1.0; +https://trip-planner.app) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { imageUrl: faviconFallback(target.hostname) },
        {
          status: 200,
          headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
        }
      );
    }

    // Stream only the first MAX_HTML_BYTES so we don't download huge pages
    const reader = res.body?.getReader();
    if (!reader) {
      return NextResponse.json(
        { imageUrl: faviconFallback(target.hostname) },
        { status: 200 }
      );
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_HTML_BYTES) break;
    }
    reader.cancel().catch(() => {});
    const html = new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc);
        merged.set(c, acc.length);
        return merged;
      }, new Uint8Array(0))
    );

    const imageUrl =
      extractMetaContent(html, "og:image") ||
      extractMetaContent(html, "og:image:url") ||
      extractMetaContent(html, "twitter:image") ||
      extractMetaContent(html, "twitter:image:src") ||
      faviconFallback(target.hostname);

    // Resolve relative URLs
    let resolved = imageUrl;
    try {
      resolved = new URL(imageUrl, target.toString()).toString();
    } catch {
      // keep as-is
    }

    return NextResponse.json(
      { imageUrl: resolved },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
      }
    );
  } catch {
    return NextResponse.json(
      { imageUrl: faviconFallback(target.hostname) },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
      }
    );
  }
}
