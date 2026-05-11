import { NextResponse } from "next/server";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { resolveCommonsDirectImageUrl } from "@/lib/trip/wikimediaCommonsResolve";
import type { TripHeroCoverPersistPayload } from "@/lib/types/trip";

type IncomingTrip = {
  id?: string;
  title?: string;
  description?: string;
  destinations?: Array<{
    id?: string;
    title?: string;
    description?: string;
    location?: string;
  }>;
};

function openaiKey(): string | undefined {
  return (
    process.env.OPENAI_SA_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

function openaiModel(): string {
  return process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini";
}

function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim();
}

function anthropicModel(): string {
  return process.env.ANTHROPIC_CHAT_MODEL?.trim() || "claude-haiku-4-5";
}

/**
 * Hero needs `web_search` whenever Claude is used. Each search + `pause_turn` round-trip inflates
 * input tokens (Anthropic org TPM). Default **1** search; set `HERO_COVER_WEB_SEARCH_MAX_USES=2`
 * only if you need a second query and your org TPM allows it.
 */
function heroAnthropicWebSearchUses(): number {
  if (!anthropicKey()) return 0;
  const heroRaw = process.env.HERO_COVER_WEB_SEARCH_MAX_USES?.trim();
  if (heroRaw !== undefined && heroRaw !== "") {
    const n = Number(heroRaw);
    if (Number.isFinite(n) && n >= 1) return Math.min(2, Math.floor(n));
  }
  return 1;
}

/** When `HERO_COVER_DEBUG=1`, log + JSON `photoDebug` shows exactly what we sent and what Claude returned. */
function heroCoverDebugEnabled(): boolean {
  const v = process.env.HERO_COVER_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

type HeroCoverPhotoDebug = {
  model: string;
  webSearchMaxUses: number;
  maxOutputTokens: number;
  temperature: number;
  systemPrompt: string;
  userMessage: string;
  rawAssistantText?: string;
  anthropicHttpStatus?: number;
  anthropicHttpBody?: string;
  stage?: "anthropic_ok" | "parse_failed" | "verify_failed" | "anthropic_http_error";
  verifiedUrl?: string;
};

function formatAnthropicHttpError(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  try {
    const j = JSON.parse(trimmed) as { error?: { message?: string; type?: string } };
    const msg = j.error?.message?.trim();
    if (msg) {
      if (/input tokens per minute|50[,\s]?000.*input/i.test(msg)) {
        return (
          "Anthropic org input-token rate limit (tokens/minute). Wait ~60s, avoid many parallel hero/chat " +
          "calls, set HERO_COVER_WEB_SEARCH_MAX_USES=1 (default), and shorten trip notes if pasted into destinations."
        );
      }
      return msg.length > 320 ? `${msg.slice(0, 320)}…` : msg;
    }
  } catch {
    /* not JSON */
  }
  if (status === 401) return "Anthropic rejected the API key (check ANTHROPIC_API_KEY).";
  if (status === 429) return "Anthropic rate limit — try again in a moment.";
  const hint =
    trimmed.length > 0 ? ` — ${trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed}` : "";
  return `Anthropic request failed (HTTP ${status})${hint}`;
}

/** Map common non-Latin trip titles so geography rules still apply (e.g. Hebrew "Thailand"). */
function impliedEnglishFromTripTitle(title: string): string {
  const extra: string[] = [];
  const pairs: [RegExp, string][] = [
    [/תאילנד/, "Thailand"],
    [/יפן/, "Japan"],
    [/יוון/, "Greece"],
    [/אינדונזיה/, "Indonesia"],
    [/פיליפינים|הפיליפינים/, "Philippines"],
    [/מלדיבים/, "Maldives"],
    [/וייטנאם|ווייטנאם/, "Vietnam"],
    [/מקסיקו/, "Mexico"],
    [/ספרד/, "Spain"],
    [/פורטוגל/, "Portugal"],
    [/קרואטיה/, "Croatia"],
    [/טורקיה/, "Turkey"],
  ];
  for (const [re, word] of pairs) {
    if (re.test(title)) extra.push(word);
  }
  return extra.join(" ");
}

function tripDestinationsHaystack(trip: IncomingTrip): string {
  const parts: string[] = [];
  const title = typeof trip.title === "string" ? trip.title : "";
  if (title) parts.push(title);
  const implied = impliedEnglishFromTripTitle(title);
  if (implied) parts.push(implied);
  if (trip.description) parts.push(trip.description);
  for (const d of trip.destinations ?? []) {
    parts.push([d.title, d.location, d.description].filter(Boolean).join(" "));
  }
  return parts.join(" ").toLowerCase();
}

type HeroScenery = {
  /** English tokens appended to stock-search / heuristic query. */
  biasTokens: string;
  /** One sentence for LLM system prompts. */
  instruction: string;
};

/**
 * Avoid generic "landscape" = random alpine peaks. Bias imagery type from destinations
 * (Thailand → tropical islands/beaches unless the trip names northern mountains).
 */
function heroSceneryForTrip(trip: IncomingTrip): HeroScenery {
  const hay = tripDestinationsHaystack(trip);

  const mountainTrip =
    /\b(chiang\s*mai|doi\s*inthanon|north\s*thailand|golden\s*triangle|sapa\b|fansipan|everest|himalaya|himalayas|annapurna|nepal\s*trek|kilimanjaro|alps|dolomites|swiss\s*alps|pyrenees|rockies|andes(?!\s*(carib|patagonia\s*ice))|patagonia\s*(torres|fitz)|mount\s*rainier|denali|banff|jasper|el\s*chalten|k2\b|trekking|summit\s+climb)\b/i.test(
      hay
    ) ||
    (/\b(mountain|alpine|trek|summit|peak|hiking\s+high)\b/i.test(hay) &&
      /\b(nepal|tibet|bhutan|peru\s*(cusco|machu)|chile\s*(patagonia|torres)|switzerland|austria\s*tyrol)\b/i.test(hay));

  if (mountainTrip) {
    return {
      biasTokens: "mountains alpine scenic peaks dramatic landscape",
      instruction:
        "Trip text suggests mountains / highlands — pick hero imagery that matches (peaks, alpine, highland trails). Do not use unrelated tropical beach stock.",
    };
  }

  const tropicalOrIslands =
    /\b(thailand|thai\b|phuket|krabi|phi\s*phi|koh\s|ko\s|samui|koh\s*samui|pattaya|andaman|gulf\s*of\s*thailand|maldives|bali|lombok|gili|fiji|seychelles|mauritius|philippines|palawan|boracay|cebu|el\s*nido|vietnam.*(phu\s*quoc|nha\s*trang|da\s*nang)|cambodia.*(kampot|koh\s*rong)|mexico.*(tulum|cancun|riviera\s*maya|playa)|belize|aruba|jamaica|barbados|grenada|bahamas|cayman|hawaii|oahu|maui|kauai|tonga|samoa|vanuatu|cook\s*islands|zanzibar|mozambique|cap\s*verde)\b/i.test(
      hay
    ) ||
    /\b(island|islands|beach|beaches|atoll|lagoon|snorkel|scuba|reef|coral|palm|turquoise|caribbean)\b/i.test(hay);

  if (tropicalOrIslands) {
    return {
      biasTokens: "tropical beach islands turquoise sea coastline palms limestone karst lagoon",
      instruction:
        "This trip is islands / tropical coast / coral-sea — the hero MUST show beaches, islands, lagoons, tropical shoreline, or karst sea (e.g. Phang Nga style), matching the destination list. Do NOT use snowy alpine mountain panoramas or unrelated cold climates.",
    };
  }

  if (
    /\b(greece|crete|santorini|mykonos|cyclades|naxos|paros|cyprus|malta|amalfi|cinque\s*terre|croatia|adriatic|dubrovnik|split\b|nice\b|french\s*riviera|côte\s*d'azur|algarve|costa\s*brava|ibiza|mallorca|menorca)\b/i.test(
      hay
    )
  ) {
    return {
      biasTokens: "Mediterranean coastal sea azure harbor cliffs villages scenic shoreline",
      instruction:
        "Mediterranean / Adriatic coastal vibe — sea, harbors, coastal cliffs or islands that match the listed places. Avoid mismatched biomes.",
    };
  }

  return {
    biasTokens: "scenic landmark destination iconic view",
    instruction:
      "Match the typical landscape of the listed destinations (urban waterfront, desert, forest, etc.). Avoid random unrelated biomes (e.g. no generic Alps for a flatland city trip).",
  };
}

/**
 * Heuristic English search string from {@link IncomingTrip.destinations}
 * (location → title → short description per row), plus Latin hints for non-Latin titles.
 */
function heuristicSearchQuery(trip: IncomingTrip): string {
  const segments: string[] = [];
  for (const d of trip.destinations ?? []) {
    const loc = typeof d.location === "string" ? d.location.trim() : "";
    const title = typeof d.title === "string" ? d.title.trim() : "";
    const desc = typeof d.description === "string" ? d.description.trim() : "";
    let seg = loc || title || "";
    if (!seg) continue;
    if (title && loc && title !== loc && !loc.includes(title) && !title.includes(loc)) {
      seg = `${title} ${loc}`;
    } else if (desc && desc.length <= 80 && !seg.toLowerCase().includes(desc.slice(0, 12).toLowerCase())) {
      seg = `${seg} ${desc}`;
    }
    const low = seg.toLowerCase();
    if (!segments.some((s) => s.toLowerCase() === low)) segments.push(seg);
  }
  const latin = latinPlaceHintsFromTrip(trip);
  if (latin) {
    const low = latin.toLowerCase();
    if (!segments.some((s) => low.includes(s.toLowerCase()) || s.toLowerCase().includes(low.slice(0, 24)))) {
      segments.push(latin);
    }
  }
  let core = segments.join(", ").replace(/\s+/g, " ").trim();
  const implied = impliedEnglishFromTripTitle(typeof trip.title === "string" ? trip.title : "");
  if (implied) {
    const first = implied.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first && !core.toLowerCase().includes(first)) {
      core = `${implied} ${core}`.trim();
    }
  }
  if (!core) core = (typeof trip.title === "string" ? trip.title.trim() : "") || "travel";
  const { biasTokens } = heroSceneryForTrip(trip);
  return `${core} ${biasTokens} color photography`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Short comma/semicolon line for agent prompts — destination-derived only. */
function destinationAnchorLine(trip: IncomingTrip): string {
  const parts: string[] = [];
  for (const d of trip.destinations ?? []) {
    const loc = typeof d.location === "string" ? d.location.trim() : "";
    const title = typeof d.title === "string" ? d.title.trim() : "";
    const chunk = loc && title && loc !== title ? `${title}; ${loc}` : loc || title;
    if (!chunk) continue;
    const k = chunk.toLowerCase();
    if (!parts.some((p) => p.toLowerCase() === k)) parts.push(chunk);
  }
  return parts.join(" | ").slice(0, 500);
}

function latinPlaceHintsFromTrip(trip: IncomingTrip): string {
  const parts: string[] = [];
  if (typeof trip.description === "string") {
    for (const seg of trip.description.split(/[,;/|]/)) {
      const s = seg.trim();
      if (s.length >= 3 && /[A-Za-z]{2,}/.test(s)) parts.push(s.replace(/\s+/g, " "));
    }
  }
  for (const d of trip.destinations ?? []) {
    for (const raw of [d.location, d.description, d.title]) {
      if (typeof raw !== "string") continue;
      for (const seg of raw.split(/[,;/|]/)) {
        const s = seg.trim();
        if (s.length < 3) continue;
        if (!/[A-Za-z]{2,}/.test(s)) continue;
        parts.push(s.replace(/\s+/g, " "));
      }
    }
  }
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
    if (uniq.length >= 6) break;
  }
  return uniq.join(" ").slice(0, 200);
}

function sliceStr(s: string | undefined, max: number): string {
  if (typeof s !== "string") return "—";
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Compact trip text for Claude hero (reduces org TPM vs. full itinerary pasted into every web_search turn). */
function buildHeroCoverTripContextLines(trip: IncomingTrip): string {
  const lines: string[] = [];
  lines.push(
    "### Trip destinations — image search and final URL MUST match at least one of these places (same city/region/country), not a random country."
  );
  let i = 1;
  for (const d of trip.destinations?.slice(0, 8) ?? []) {
    lines.push(
      `${i}. title: ${sliceStr(d.title, 100)} | location: ${sliceStr(d.location, 120)} | notes: ${sliceStr(d.description, 140)}`
    );
    i++;
  }
  lines.push("### Trip metadata (secondary)");
  lines.push(`Trip title: ${sliceStr(trip.title, 120)}`);
  if (trip.description) lines.push(`Trip notes: ${sliceStr(trip.description, 400)}`);
  const hints = latinPlaceHintsFromTrip(trip);
  if (hints) {
    lines.push(`Latin-script query hints: ${hints}`);
  }
  lines.push(`### Scenery type (follow this): ${heroSceneryForTrip(trip).instruction}`);
  return lines.join("\n").slice(0, 4500);
}

function buildTripContextLines(trip: IncomingTrip): string {
  const lines: string[] = [];
  lines.push(
    "### Trip destinations — image search and final URL MUST match at least one of these places (same city/region/country), not a random country."
  );
  let i = 1;
  for (const d of trip.destinations?.slice(0, 24) ?? []) {
    lines.push(
      `${i}. title: ${d.title ?? "—"} | location/address line: ${d.location ?? "—"} | description: ${d.description ?? "—"}`
    );
    i++;
  }
  lines.push("### Trip metadata (secondary — do not pick imagery outside the destination list above)");
  lines.push(`Trip title: ${trip.title ?? ""}`);
  if (trip.description) lines.push(`Trip notes: ${trip.description}`);
  const hints = latinPlaceHintsFromTrip(trip);
  if (hints) {
    lines.push(
      `Latin-script keywords derived from destinations (use in English web queries when titles/locations are not Latin script): ${hints}`
    );
  }
  lines.push(`### Scenery type (follow this): ${heroSceneryForTrip(trip).instruction}`);
  return lines.join("\n");
}

async function refineSearchQueryWithOpenAI(trip: IncomingTrip): Promise<string | null> {
  const key = openaiKey();
  if (!key) return null;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel(),
      temperature: 0.25,
      max_tokens: 80,
      messages: [
        {
          role: "system",
          content:
            'Reply with JSON only: {"q":"<english image search query>"}. Max 18 words. The query MUST be grounded in the numbered trip destinations AND must match the "Scenery type" line (e.g. Thailand / islands trips → tropical beach / turquoise sea / limestone karst — never unrelated snowy mountain ranges unless the trip explicitly names mountain regions). Use location/city/country strings from the rows. Color photo. No quotes inside q.',
        },
        { role: "user", content: buildTripContextLines(trip) },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const j = JSON.parse(cleaned) as { q?: string };
    const q = typeof j.q === "string" ? j.q.trim() : "";
    return q.length > 2 ? q.slice(0, 200) : null;
  } catch {
    return null;
  }
}

function isLikelyDirectImageUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (/\.(jpe?g|png|webp|avif|svg)(\?|#|$)/i.test(path)) return true;
    if (host.endsWith("wikimedia.org") && (path.includes("/commons/") || path.includes("/wikipedia/commons"))) {
      return true;
    }
    if (host === "commons.wikimedia.org" && path.includes("special:filepath")) return true;
    return false;
  } catch {
    return false;
  }
}

function parseHeroJsonFromAssistantText(raw: string): Omit<TripHeroCoverPersistPayload, "query" | "destinationLabel"> | null {
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, "")
    .replace(/```[\s\S]*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: unknown;
  try {
    j = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!isLikelyDirectImageUrl(url)) return null;
  return {
    url,
    photographerName: typeof o.photographerName === "string" ? o.photographerName.trim().slice(0, 200) : undefined,
    photoPageUrl: typeof o.photoPageUrl === "string" ? o.photoPageUrl.trim().slice(0, 500) : undefined,
    licenseNote:
      typeof o.licenseNote === "string" && o.licenseNote.trim()
        ? o.licenseNote.trim().slice(0, 240)
        : "Travel agent (web search)",
  };
}

/**
 * Claude often wraps JSON in prose or escapes slashes; strict parse then regex / URL scan.
 */
function tryExtractHeroFromLooseModelText(raw: string): Omit<TripHeroCoverPersistPayload, "query" | "destinationLabel"> | null {
  const normalized = raw.replace(/\\\//g, "/");
  const quoted = normalized.match(/"url"\s*:\s*"(https?:\/\/[^"\n\r]+)"/i);
  if (quoted?.[1]) {
    let url = quoted[1].replace(/\\"/g, '"').trim();
    try {
      url = decodeURIComponent(url);
    } catch {
      /* keep */
    }
    if (isLikelyDirectImageUrl(url)) {
      const nameM = normalized.match(/"photographerName"\s*:\s*"([^"]*)"/i);
      const pageM = normalized.match(/"photoPageUrl"\s*:\s*"(https?:\/\/[^"\n\r]+)"/i);
      const licM = normalized.match(/"licenseNote"\s*:\s*"([^"]*)"/i);
      return {
        url,
        photographerName: nameM?.[1]?.trim().slice(0, 200) || undefined,
        photoPageUrl: pageM?.[1]?.replace(/\\\//g, "/").trim().slice(0, 500) || undefined,
        licenseNote: licM?.[1]?.trim().slice(0, 240) || "Travel agent (web search)",
      };
    }
  }

  for (const m of normalized.matchAll(/https:\/\/[^\s"'<>[\](),]+/gi)) {
    let candidate = m[0].replace(/[)\]},.;:]+$/g, "");
    if (candidate.endsWith("\\")) candidate = candidate.slice(0, -1);
    if (isLikelyDirectImageUrl(candidate)) {
      return { url: candidate, licenseNote: "Travel agent (web search)" };
    }
  }
  return null;
}

const HERO_AGENT_SYSTEM = `You are the trip planner travel agent. You MUST use the web_search tool at least once before answering — treat it like **Google Search**: write queries the user would type into google.com (destination names, "photos", "tourism board", "wikimedia commons", "national park official site", etc.), then open the results and extract a real **direct** HTTPS image URL (the actual file URL that works in <img src>, not a gallery HTML page).

Task: find ONE publicly usable, full-color, wide / landscape travel photograph that depicts at least one place from the user's **trip destinations** list (same geography: city / region / country named in those rows). Default to the first destination row if unsure; if several stops are listed, the image must still match one of them — not a unrelated country.

The **Scenery type** section in the user message is mandatory: e.g. Thailand / island hops → tropical beaches, islands, lagoons, or coastal karst — NOT generic alpine snow peaks from another continent.

Hard rules:
1. Use web_search with **Google-style** natural-language queries (include place names from the trip + scenery words). Do not invent URLs — only URLs you saw on opened result pages.
2. The JSON field "url" MUST be a direct HTTPS image URL the browser can load in <img src> — copy it **exactly** from the search result (do not guess the two-letter hash folders under upload.wikimedia.org; wrong hashes return 404). Prefer pasting the full link shown on the file page. Always set "photoPageUrl" to the commons.wikimedia.org **File:** page when the image is from Commons so the server can fix the download URL if needed.
3. Full color only — reject black-and-white archives, WWII-era scans, halftone, sepia, or monochrome unless the page clearly shows a modern color reproduction.
4. "photoPageUrl" should be the attribution / source page when available (Wikimedia file page, tourism board article, official park page, etc.).
5. Your entire final reply MUST be a single JSON object on one logical line — no markdown fences, no commentary. Shape:
{"url":"https://...","photographerName":"optional","photoPageUrl":"https://...","licenseNote":"short source note"}`;

type RunHeroAnthropicResult =
  | { ok: true; hero: TripHeroCoverPersistPayload; photoDebug?: HeroCoverPhotoDebug }
  | { ok: false; reason: "no_anthropic_key" }
  | { ok: false; reason: "anthropic_http" | "bad_parse" | "verify_url"; message: string; photoDebug?: HeroCoverPhotoDebug };

async function runHeroCoverAnthropic(opts: { trip: IncomingTrip; searchHint: string }): Promise<RunHeroAnthropicResult> {
  const key = anthropicKey();
  const webUses = heroAnthropicWebSearchUses();
  if (!key) return { ok: false, reason: "no_anthropic_key" };

  const model = anthropicModel();
  const anchors = destinationAnchorLine(opts.trip);
  const userMessage = `${buildHeroCoverTripContextLines(opts.trip)}

Anchors for queries: ${anchors || "(see list above)"}
Search hint: ${sliceStr(opts.searchHint, 400)}

Use web_search like Google (place + scenery + wikimedia commons), open a hit, copy one direct HTTPS image URL. Return JSON only.`.slice(0, 8000);

  const buildDebug = (extra: Partial<HeroCoverPhotoDebug> = {}): HeroCoverPhotoDebug | undefined => {
    if (!heroCoverDebugEnabled()) return undefined;
    return {
      model,
      webSearchMaxUses: webUses,
      maxOutputTokens: 900,
      temperature: 0.25,
      systemPrompt: HERO_AGENT_SYSTEM,
      userMessage,
      ...extra,
    };
  };

  const dbg0 = buildDebug();
  if (dbg0) {
    console.log("\n========== [hero-cover] HERO_COVER_DEBUG outbound ==========\n");
    console.log("model / webSearchMaxUses / maxOutputTokens / temperature:", {
      model: dbg0.model,
      webSearchMaxUses: dbg0.webSearchMaxUses,
      maxOutputTokens: dbg0.maxOutputTokens,
      temperature: dbg0.temperature,
    });
    console.log("\n--- system prompt ---\n", dbg0.systemPrompt);
    console.log("\n--- user message ---\n", dbg0.userMessage);
    console.log("\n========== end outbound ==========\n");
  }

  const result = await completeTripAssistantAnthropic({
    apiKey: key,
    model,
    system: HERO_AGENT_SYSTEM,
    turns: [{ role: "user", content: userMessage }],
    maxOutputTokens: 900,
    temperature: 0.25,
    webSearchMaxUses: webUses,
  });

  if (!result.ok) {
    console.warn("[hero-cover] Anthropic web search failed", result.status, result.body.slice(0, 400));
    const message = formatAnthropicHttpError(result.status, result.body);
    const photoDebug = buildDebug({
      stage: "anthropic_http_error",
      anthropicHttpStatus: result.status,
      anthropicHttpBody: result.body.slice(0, 16_000),
    });
    if (photoDebug) {
      console.log("\n========== [hero-cover] HERO_COVER_DEBUG Anthropic HTTP error ==========\n");
      console.log("status:", result.status);
      console.log("\n--- response body (truncated) ---\n", photoDebug.anthropicHttpBody);
      console.log("\n========== end error body ==========\n");
    }
    return { ok: false, reason: "anthropic_http", message, photoDebug };
  }

  const photoDebugAfterOk = buildDebug({ rawAssistantText: result.text, stage: "anthropic_ok" });
  if (photoDebugAfterOk) {
    console.log("\n========== [hero-cover] HERO_COVER_DEBUG raw model reply ==========\n");
    console.log(result.text ?? "(empty text)");
    console.log("\n========== end raw reply ==========\n");
  }

  try {
    await recordLlmUsageUsd({
      provider: "anthropic",
      model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
  } catch (e) {
    console.warn("[hero-cover] recordLlmUsageUsd failed", e);
  }

  let parsed = parseHeroJsonFromAssistantText(result.text);
  if (!parsed) parsed = tryExtractHeroFromLooseModelText(result.text);
  if (!parsed) {
    console.warn("[hero-cover] Claude OK but no valid hero JSON", result.text.slice(0, 600));
    return {
      ok: false,
      reason: "bad_parse",
      message:
        "Claude did not return a usable direct image URL (HTTPS, preferably .jpg/.png/.webp or upload.wikimedia.org). Open DevTools → Network → hero-cover response for details, or try refresh.",
      photoDebug: buildDebug({ rawAssistantText: result.text, stage: "parse_failed" }),
    };
  }

  const commonsResolved = await resolveCommonsDirectImageUrl(parsed.url, parsed.photoPageUrl);
  if (commonsResolved) {
    parsed = { ...parsed, url: commonsResolved };
  }

  try {
    await assertHeroImageUrlReachable(parsed.url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "verify_url",
      message,
      photoDebug: buildDebug({
        rawAssistantText: result.text,
        stage: "verify_failed",
        verifiedUrl: parsed.url,
      }),
    };
  }

  const hero: TripHeroCoverPersistPayload = {
    ...parsed,
    query: opts.searchHint,
    destinationLabel: undefined,
  };

  return {
    ok: true,
    hero,
    photoDebug: buildDebug({
      rawAssistantText: result.text,
      stage: "anthropic_ok",
      verifiedUrl: parsed.url,
    }),
  };
}

/** Reject dead links before persisting (saves broken Wikimedia paths from reaching the UI). */
async function assertHeroImageUrlReachable(urlStr: string): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  const headers = {
    Accept: "image/*,*/*;q=0.5",
    Range: "bytes=0-4095",
    "User-Agent": "Mozilla/5.0 (compatible; TripPlannerHeroVerify/1.0) AppleWebKit/537.36",
    Referer: "https://commons.wikimedia.org/",
  };
  try {
    let res = await fetch(urlStr, {
      method: "GET",
      headers,
      redirect: "follow",
      cache: "no-store",
      signal: ac.signal,
    });

    if (res.status === 416) {
      res = await fetch(urlStr, {
        method: "GET",
        headers: { Accept: "image/*,*/*;q=0.5", "User-Agent": headers["User-Agent"], Referer: headers.Referer },
        redirect: "follow",
        cache: "no-store",
        signal: ac.signal,
      });
    }

    if (!res.ok) {
      throw new Error(
        `Image URL returned HTTP ${res.status} (file missing or URL wrong — common on Wikimedia if the path is off). Use refresh to try again.`
      );
    }

    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (
      ct &&
      !ct.startsWith("image/") &&
      ct !== "application/octet-stream" &&
      ct !== "binary/octet-stream"
    ) {
      throw new Error(
        "Image URL did not return an image content type. Use refresh so the model can pick another file."
      );
    }
    await res.arrayBuffer().catch(() => undefined);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Image URL verification timed out. Try refresh.");
    }
    if (
      e instanceof Error &&
      (e.message.includes("HTTP") ||
        e.message.includes("content type") ||
        e.message.includes("timed out"))
    ) {
      throw e;
    }
    throw new Error(
      `Could not verify image URL: ${e instanceof Error ? e.message : String(e)}. Try refresh.`
    );
  } finally {
    clearTimeout(timer);
  }
}

function validateTrip(body: unknown): IncomingTrip | null {
  if (!body || typeof body !== "object") return null;
  const trip = (body as { trip?: unknown }).trip;
  if (!trip || typeof trip !== "object") return null;
  const t = trip as IncomingTrip;
  if (!t.destinations || !Array.isArray(t.destinations) || t.destinations.length === 0) return null;
  return t;
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const trip = validateTrip(json);
  if (!trip) {
    return NextResponse.json({ error: "Trip must include at least one destination" }, { status: 400 });
  }

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) {
    return NextResponse.json({ error: budgetGate.message }, { status: 429 });
  }

  const heuristic = heuristicSearchQuery(trip);
  let searchHint = heuristic;
  try {
    const refined = await refineSearchQueryWithOpenAI(trip);
    if (refined) searchHint = refined;
  } catch {
    /* optional */
  }

  const dest0 = trip.destinations?.[0];
  const destinationLabel =
    [dest0?.title, dest0?.location].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)[0] ||
    trip.title?.trim() ||
    undefined;

  const run = await runHeroCoverAnthropic({ trip, searchHint });

  if (!run.ok && run.reason === "no_anthropic_key") {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY so the server can find a direct image URL using web search." },
      { status: 503 }
    );
  }

  if (!run.ok) {
    return NextResponse.json(
      {
        error: run.message,
        ...(run.photoDebug ? { photoDebug: run.photoDebug } : {}),
      },
      { status: 502 }
    );
  }

  const heroCover: TripHeroCoverPersistPayload = {
    ...run.hero,
    destinationLabel: destinationLabel ?? run.hero.destinationLabel,
    query: searchHint,
  };

  return NextResponse.json({
    heroCover,
    ...(run.photoDebug ? { photoDebug: run.photoDebug } : {}),
  });
}
