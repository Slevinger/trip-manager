import { NextRequest, NextResponse } from "next/server";
import { fetchImageViaOgFetcher } from "@/lib/server/ogFetcher";

export const maxDuration = 60;

/**
 * POST { label, dates?, recId, optionId }
 * Runs og-fetcher (Booking.com Playwright scrape) for a single hotel suggestion option
 * and returns { imageUrl?, priceNote? }.
 * Called by the client in the background after the main suggestion stream closes.
 */
export async function POST(req: NextRequest) {
  let body: {
    label?: unknown;
    dates?: unknown;
    recId?: unknown;
    optionId?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "Missing label" }, { status: 400 });

  let dates: { checkin: string; checkout: string; adults: number } | undefined;
  if (
    body.dates &&
    typeof body.dates === "object" &&
    !Array.isArray(body.dates)
  ) {
    const d = body.dates as Record<string, unknown>;
    if (
      typeof d.checkin === "string" &&
      typeof d.checkout === "string" &&
      typeof d.adults === "number"
    ) {
      dates = { checkin: d.checkin, checkout: d.checkout, adults: d.adults };
    }
  }

  const result = await fetchImageViaOgFetcher(label, dates);
  if (!result) return NextResponse.json({});

  return NextResponse.json({
    imageUrl: result.imageUrl,
    ...(result.priceNote ? { priceNote: result.priceNote } : {}),
  });
}
