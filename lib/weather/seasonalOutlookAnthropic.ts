import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { logCaughtExceptionServer } from "@/lib/logCaughtExceptionServer";
import { recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";
import {
  loadSeasonalOutlookCache,
  saveSeasonalOutlookCache,
  seasonalOutlookFingerprint,
} from "@/lib/weather/seasonalOutlookFirestore";

/** Process-local fallback when Firestore Admin is unavailable (same UTC day + fingerprint). */
const memoryDayCache = new Map<string, string>();

function seasonalAgentEnabled(): boolean {
  const v = process.env.WEATHER_SEASONAL_AGENT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function anthropicModel(): string {
  return process.env.ANTHROPIC_CHAT_MODEL?.trim() || "claude-haiku-4-5";
}

function parseOutlookJson(text: string): string | null {
  const t = text.trim();
  const m = t.match(/"outlook"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m?.[1]) {
    return m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .slice(0, 800);
  }
  try {
    const j = JSON.parse(t) as { outlook?: string };
    if (typeof j.outlook === "string" && j.outlook.trim()) return j.outlook.trim().slice(0, 800);
  } catch (e) {
    logCaughtExceptionServer(e, "seasonalOutlookAnthropic/parseOutlookJson");
  }
  return null;
}

/**
 * Optional Claude + web_search: short **seasonal / climate** context for the trip window.
 * Persists to Firestore `weatherSeasonalOutlook` (doc id = fingerprint) — **at most one Anthropic call per UTC calendar day**
 * per fingerprint; reused until the next UTC day. Skipped entirely when the API route uses `mode: "trip"` (real forecast window).
 */
export async function getSeasonalWeatherOutlook(opts: {
  apiKey: string;
  lat: number;
  lon: number;
  tripStartIso: string;
  tripEndIso: string;
  destHints: string;
}): Promise<string | null> {
  if (!seasonalAgentEnabled()) return null;

  const todayUtc = new Date().toISOString().slice(0, 10);
  const fingerprint = seasonalOutlookFingerprint({
    lat: opts.lat,
    lon: opts.lon,
    tripStartIso: opts.tripStartIso,
    tripEndIso: opts.tripEndIso,
    destHints: opts.destHints,
  });

  const fromDb = await loadSeasonalOutlookCache({ fingerprint, todayUtcDay: todayUtc });
  if (fromDb) return fromDb;

  const memKey = `${fingerprint}|${todayUtc}`;
  const fromMem = memoryDayCache.get(memKey);
  if (fromMem) return fromMem;

  const system = `You are a concise travel-meteorology assistant. You MUST call web_search exactly once for reputable seasonal climate information (official tourism, meteorological services, or well-known climate summaries) for the places and months involved.

Rules:
- Output a single JSON object on one line, no markdown fences: {"outlook":"<plain text max 420 chars>"}.
- Describe **seasonal patterns** (typical rain/wind/humidity, broad temperature ranges) for that geography and calendar period.
- Do **not** claim specific daily highs/lows for future dates. Do not present model guesses as operational forecasts.
- If search results are thin, give cautious general guidance for that region and season.`;

  const user = `Trip window (calendar): ${opts.tripStartIso.slice(0, 10)} → ${opts.tripEndIso.slice(0, 10)}
Place hints: ${opts.destHints || "(coordinates only — infer region from search)"}

Return JSON only.`;

  const result = await completeTripAssistantAnthropic({
    apiKey: opts.apiKey,
    model: anthropicModel(),
    system,
    turns: [{ role: "user", content: user.slice(0, 8000) }],
    maxOutputTokens: 500,
    temperature: 0.35,
    webSearchMaxUses: 1,
  });

  if (!result.ok) return null;
  const text = parseOutlookJson(result.text);
  if (!text) return null;

  memoryDayCache.set(memKey, text);
  await saveSeasonalOutlookCache({
    fingerprint,
    todayUtcDay: todayUtc,
    outlook: text,
    lat: opts.lat,
    lon: opts.lon,
    tripStartIso: opts.tripStartIso,
    tripEndIso: opts.tripEndIso,
  });
  try {
    await recordLlmUsageUsd({
      provider: "anthropic",
      model: anthropicModel(),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
  } catch (e) {
    logCaughtExceptionServer(e, "seasonalOutlookAnthropic/recordLlmUsageUsd");
  }
  return text;
}
