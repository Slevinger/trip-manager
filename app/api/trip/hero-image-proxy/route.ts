import { NextResponse } from "next/server";

const MAX_URL_LEN = 4096;

function isAllowedHeroImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.endsWith(".wikimedia.org");
}

function upstreamContentTypeLooksLikeImage(ct: string): boolean {
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    base.startsWith("image/") ||
    base === "application/octet-stream" ||
    base === "binary/octet-stream"
  );
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw?.trim()) {
    return NextResponse.json({ error: "url query required" }, { status: 400 });
  }
  if (raw.length > MAX_URL_LEN) {
    return NextResponse.json({ error: "url too long" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:") {
    return NextResponse.json({ error: "only https" }, { status: 400 });
  }
  if (!isAllowedHeroImageHost(target.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; TripPlannerHero/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://commons.wikimedia.org/",
      },
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `upstream ${upstream.status}`, detail: "Wikimedia returned an error for this path (404 = file missing or URL typo)." },
      { status: 502 }
    );
  }

  const ctRaw = upstream.headers.get("content-type") ?? "";
  if (!upstreamContentTypeLooksLikeImage(ctRaw)) {
    return NextResponse.json({ error: "not an image", detail: ctRaw.slice(0, 120) }, { status: 502 });
  }

  const ct = ctRaw.split(";")[0]?.trim() || "application/octet-stream";

  const maxBytes = 12 * 1024 * 1024;
  const len = upstream.headers.get("content-length");
  if (len && Number.parseInt(len, 10) > maxBytes) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await upstream.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "read body failed" }, { status: 502 });
  }
  if (bytes.byteLength > maxBytes) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
