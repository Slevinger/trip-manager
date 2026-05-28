import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export interface OgFetcherResult {
  imageUrl: string;
  priceNote?: string;
}

/**
 * Scrapes Booking.com via og-fetcher (Playwright/headless Chromium).
 * Uses --json output to get image URL + live price when dates are provided.
 * Only call this for hotel/stay suggestions that have a bookingUrl.
 */
export async function fetchImageViaOgFetcher(
  label: string,
  dates?: { checkin: string; checkout: string; adults: number }
): Promise<OgFetcherResult | null> {
  try {
    const cliPath = path.join(process.cwd(), "node_modules", "og-fetcher", "cli.js");
    const extraArgs: string[] = ["--json"];
    if (dates) {
      extraArgs.push(
        "--checkin", dates.checkin,
        "--checkout", dates.checkout,
        "--adults", String(dates.adults)
      );
    }
    const { stdout } = await execFileAsync("node", [cliPath, ...extraArgs, label], {
      timeout: 30_000,
    });
    const raw = stdout.trim();
    if (!raw) return null;
    let parsed: { url?: string; priceNote?: string };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return null;
    }
    const imageUrl = parsed.url?.trim();
    if (!imageUrl) return null;
    try { new URL(imageUrl); } catch { return null; }
    console.log(
      `[og-fetcher] found image for "${label}": ${imageUrl}${parsed.priceNote ? ` | price: ${parsed.priceNote}` : ""}`
    );
    return { imageUrl, priceNote: parsed.priceNote || undefined };
  } catch (err) {
    console.log(`[og-fetcher] no result for "${label}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
