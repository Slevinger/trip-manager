# Agent Suggestions

The “agent suggestions” feature lets the trip assistant propose **structured,
actionable trip additions** (stays, transit segments, activities) that the
traveler can approve, skip, vote on, or delete. Each suggestion lives on the
trip itself (`trip.recommendations`) and, when approved, is promoted into a
real `TripStep` or appended into an existing step’s interval list.

This document describes the full pipeline end-to-end: classification of the
user message, prompt construction, the JSON contract the LLM emits, parsing
and validation, persistence, fan‑out to collaborators, and the UI surfaces.

---

## 1. Data model

Suggestions are first‑class citizens on the `Trip` document.

```291:323:lib/types/trip.ts
/**
 * Pending suggestion for the trip — surfaced in the floating notifications dock.
 *
 * A recommendation is a *bundle of options* (each carrying a full step-interval
 * payload of the same `kind`). The user picks one option to approve: either it
 * becomes a **new** step, or — when {@link BaseRecommendationOption#targetStepId}
 * is set — the interval is **merged** into that existing step’s `stepIntervals`
 * (same `stepType` as `kind`). The whole recommendation stays in the queue until
 * the user approves an option or deletes the recommendation.
 *
 * Recommendations live alongside `steps` rather than inside one so the queue
 * is order-independent and can be authored by the assistant or other tooling.
 */
export type TripRecommendationKind = "stay" | "transit" | "activity";

interface BaseRecommendationOption {
  id: string;
  label?: string;
  note?: string;
  destinations?: Destination[];
  targetStepId?: string;
}
```

Key shape:

- A **`TripRecommendation`** is a discriminated union on `kind`
  (`stay | transit | activity`) holding one or more **options**.
- Each **`TripRecommendationOption`** carries a full step interval of the
  matching kind (`StayStepInterval`, `TransitStepInterval`, or
  `ActivityStepInterval`), plus optional `label`, `note`, registry
  `destinations[]`, and a `targetStepId` (when the option should be merged
  into an existing step rather than create a new step).
- Activity options also carry `hostStayStepId` — the stay step `id` the
  activity is anchored to, used by the planner so activities sit under the
  right base.

Persisted on `Trip`:

```515:531:lib/types/trip.ts
  recommendations?: TripRecommendation[];
  removedRecommendationIds?: string[];
  ...
  recommendationVotes?: RecommendationVote[];
```

- `recommendations`: the active queue.
- `removedRecommendationIds`: tombstones so a thread snapshot can never
  resurrect a card the user explicitly deleted/approved.
- `recommendationVotes`: collaborative thumbs‑up per option (one vote per
  traveler per recommendation).

---

## 2. End-to-end flow

```
User types a message in the SmartDock chat
         │
         ▼
useTripAssistant.send()                                  (lib/agent/useTripAssistant.ts)
         │
         │  1) classify the message
         ▼
POST /api/chat/trip-assistant-classify   →  "general" | "specific" | "suggestions"
         │
         │  2) client booster (regex) may upgrade "specific" → "suggestions"
         │     via tripAssistantUserWantsStructuredTripProposals()
         ▼
POST /api/chat/trip-assistant
         │   - builds system prompt with the suggestion schema
         │   - appends TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX when
         │     classifiedMessageKind === "suggestions"
         │   - calls Anthropic or OpenAI
         ▼
LLM reply (markdown + fenced ```trip-suggestions JSON``` block)
         │
         │   - extractTripSuggestionsFromReply() parses + validates the
         │     fenced JSON into typed TripRecommendation[]
         │   - the reply text is stripped of the fence + ##suggestions## marker
         ▼
Response: { reply, suggestions[], requestKind, provider, model }
         │
         │  3) Client merges suggestions into the trip
         ▼
onAddRecommendations(trip, suggestions)
   → addTripRecommendation()  → persistTrip()             (lib/tripRecommendations.ts)
         │
         │  4) Persist the turn into the shared assistant thread, including
         │     the raw JSON in `recommendationsJson` (Firestore subcollection)
         ▼
POST /api/chat/shared-trip-thread-append
         │
         │  5) Other devices/collaborators read the thread, run
         │     mergeAssistantThreadRecommendationsIntoTrip(), and pick the
         │     same cards up on their copy of the trip.
         ▼
SmartDock “Suggestions” tab renders the queue with
   Approve / Skip / Delete  (and a Collab voting panel).
```

---

## 3. Classifying the user’s message

The trip assistant pre-classifies the latest turn so the **expensive** model
either sees the suggestion contract (and is told to emit JSON) or doesn’t
(and answers conversationally).

### 3.1 Server router

A tiny LLM endpoint returns exactly one of three lowercase words:

```57:80:app/api/chat/trip-assistant-classify/route.ts
const SYSTEM = [
  "You are a router for a travel-assistant chat. ...",
  "  general      → about the USER ...",
  "  specific     → about THIS trip's concrete details ...",
  "  suggestions  → the user is explicitly asking the assistant to PROPOSE concrete",
  "                 additions to THIS trip's queue ...",
  ...
].join("\n");
```

Defaults are conservative: anything unrecognized falls back to `specific`.
The router runs on the cheap classify model (`claude-haiku-4-5` /
`gpt-4o-mini` by default), with `max_tokens ≈ 12` and `temperature: 0`, so
overhead is negligible.

### 3.2 Client-side booster

After the router returns, the client may still upgrade `specific →
suggestions` when the message clearly asks for structured proposals
**anchored to this trip** (e.g. “suggest a hotel for night 3”, “give me
museums for tomorrow”). This is intentionally narrow — cross‑trip questions
(“where should I travel next”) are excluded so they stay in the `general`
lane:

```103:139:lib/tripAssistantRequestKind.ts
export function tripAssistantUserWantsStructuredTripProposals(latestUserText: string): boolean {
  ...
  const proposal = /suggest|recommend|propose|brainstorm|.../i.test(lower) || ...
  const crossTripOnly = /\b(next|future) (trip|vacation|holiday)\b/.test(lower) || ...
  const tripAnchored = /\b(hotel|hostel|stay|...|tour|excursion|booking|step|...)\b/.test(lower) || ...
  if (!tripAnchored) return false;
  if (crossTripOnly) return false;
  return true;
}
```

The classify call also drives whether the **global cross-trip memory note**
gets attached to the assistant prompt — only the `general` path pulls it in
(to save tokens):

```280:307:lib/agent/useTripAssistant.ts
        if (classifiedMessageKind !== "general") {
          if (
            (classifiedMessageKind === "specific" || classifiedMessageKind === undefined) &&
            tripAssistantUserWantsStructuredTripProposals(text)
          ) {
            classifiedMessageKind = "suggestions";
          }
        }

        const globalParts = attachGlobal
          ? partitionMemoryNotes(opts.globalChatMessages ?? [])
          : { notes: "", lines: [] as ChatLine[] };
```

---

## 4. Prompt: teaching the LLM the JSON contract

The trip-assistant system prompt is rebuilt per request from the live trip
(`lib/tripAssistantPrompt.ts`). It always carries the suggestion schema
fragment, and adds a stronger appendix when the turn is classified as
`suggestions`.

### 4.1 The schema fragment

`buildTripRecommendationSchemaPrompt()` renders TypeScript-flavoured
pseudo-JSON for every shape (`StayRecommendation`, `TransitRecommendation`,
`ActivityRecommendation`, plus options, intervals, `Destination`,
`Coordinates`, `Money`, `BookingInfo`, `Attachment`).

It is generated entirely from typed field-spec registries that are
**type-checked against `lib/types/trip.ts`**, so adding a new field
on any of those interfaces produces a TypeScript error in
`tripAssistantSuggestionSchema.ts` until the prompt is updated:

```105:122:lib/tripAssistantSuggestionSchema.ts
type RequiredFieldSpec = FieldSpec & { required: true };
type OptionalFieldSpec = FieldSpec & { required?: false };

/**
 * Forces every key of `T` to have a `FieldSpec`. The `required` flag must
 * agree with the type (required-in-`T` ⇒ `required: true`; optional-in-`T`
 * ⇒ `required` must be omitted or `false`). Add a new field to `T` and TS
 * fails this constraint until you describe it here.
 */
type ShapeRecord<T extends object> = {
  [K in keyof T]-?: undefined extends T[K] ? OptionalFieldSpec : RequiredFieldSpec;
};
```

The enums in the prompt (`STAY_TYPES`, `TRANSIT_TYPES`, `ACTIVITY_TYPES`,
`BOOKING_STATUSES`, `ATTACHMENT_TYPES`) are runtime mirrors with
`as const satisfies readonly …[]`, so renaming a value in
`lib/types/trip.ts` likewise fails to compile until the registry is
updated. No manual prompt drift is possible.

### 4.2 The fenced-block contract

The LLM is required to emit a single fenced code block with info-string
exactly `trip-suggestions`, whose body is a top-level JSON array of
`TripRecommendation` objects:

```427:507:lib/tripAssistantSuggestionSchema.ts
export function buildTripRecommendationSchemaPrompt(): string {
  return [
    "### `##suggestions##` reply contract",
    "When you classify a turn as `##suggestions##`, you MUST produce TWO things:",
    "  1. **Very short** chat for the human (1–3 sentences ...).",
    `  2. EXACTLY ONE fenced JSON block tagged \`\`\`${TRIP_SUGGESTIONS_FENCE}\`\`\` whose body is a **JSON array** ...`,
    ...
    "Authoring rules:",
    `- Allowed kinds: ${quoteEnum(TRIP_RECOMMENDATION_KINDS)}.`,
    "- The fenced body is **only** a JSON array — never wrap it in an object key.",
    "- Prefer **several** \`TripRecommendation\` rows and/or **2–3** \`options\` per row ...",
    "- Times must be ISO 8601 with timezone offset and inside the trip's date range.",
    "- Copy trip.destinations[].id strings verbatim into interval destinationId / fromDestinationId / toDestinationId ...",
    "- For kind: \"activity\", set hostStayStepId on each option to the matching trip.steps stay step id ...",
    "- Reuse existing ids whenever a place already exists on the trip; omit redundant rows from option.destinations.",
    "- Honor every DO NOT SET field — those are server-managed.",
    ...
  ].join("\n");
}
```

Important guarantees the prompt enforces on the model:

- **One** fenced block, info-string exactly `trip-suggestions`.
- Body starts with `[` and is a JSON array.
- Each option’s `interval.intervalType` MUST equal the recommendation’s `kind`.
- ISO 8601 times within trip date range, prices grounded in `trip.currency`.
- Reference existing `trip.destinations[].id` strings; only put new
  registry rows in `option.destinations`.
- Server‑managed fields (`id`, `createdAt`, `seen`) are documented as
  `DO NOT SET` — server fills them.

### 4.3 The `##…##` classification marker

A separate fragment teaches the model to **end every reply** with one of
three classification markers on its own line:

```159:167:lib/tripAssistantRequestKind.ts
export const TRIP_ASSISTANT_REQUEST_KIND_INSTRUCTION = [
  "",
  "### Classify your reply",
  `End your reply with EXACTLY one classification marker on its own final line ...`,
  `- ${REQUEST_KIND_GENERAL_MARKER}     → use when the user's latest message is about THEM ...`,
  `- ${REQUEST_KIND_SPECIFIC_MARKER}    → use when the user's latest message is about THIS trip's concrete details ...`,
  `- ${REQUEST_KIND_SUGGESTIONS_MARKER} → use when the user explicitly asks you to PROPOSE additions ...`,
  ...
].join("\n");
```

The marker is parsed back on the server (`parseTripAssistantRequestKind`)
and stripped before the reply is shown (`stripTripAssistantRequestKindMarker`).
It’s also persisted on the shared thread (`requestKind`) so memory-evolve
and future routing can read it.

### 4.4 The `suggestions` appendix

When the client tells the server `classifiedMessageKind: "suggestions"`,
the trip-assistant route appends a stricter set of instructions to the
system prompt:

```145:153:lib/tripAssistantRequestKind.ts
export const TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX = [
  "",
  "### Server classification (this turn)",
  "The user's latest message was classified as a request for **concrete trip additions** ...",
  `You MUST end with exactly ${REQUEST_KIND_SUGGESTIONS_MARKER} as the final line.`,
  "You MUST include the fenced `trip-suggestions` JSON block ...",
  "Ground options in the current trip dates and existing `trip.destinations` ids. Do **not** choose `##general##` ...",
].join("\n");
```

This is applied here on the server:

```480:488:app/api/chat/trip-assistant/route.ts
  let systemContent = buildTripAssistantSystemPrompt(tripForPrompt, { ... });
  if (classifiedMessageKind === "suggestions") {
    systemContent += TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX;
  }
```

---

## 5. Calling the LLM

`POST /api/chat/trip-assistant` (`app/api/chat/trip-assistant/route.ts`)
chooses provider based on env (`TRIP_ASSISTANT_PROVIDER`, `OPENAI_*`,
`ANTHROPIC_API_KEY`) and dispatches to Anthropic or OpenAI:

- Anthropic path uses `completeTripAssistantAnthropic` with `temperature:
  0.55` and `max_output_tokens` 4096 (8192 when web search is enabled).
- OpenAI path posts to `/v1/chat/completions` with the canonical OpenAI
  chat shape, `max_completion_tokens: 4096`.
- Both record usage against `assertMonthlyBudgetAllowsNewSpend` /
  `recordLlmUsageUsd` so a runaway agent can’t blow the monthly cap.

After the model replies:

```528:539:app/api/chat/trip-assistant/route.ts
    /** Pull any `trip-suggestions` JSON block out of the raw reply BEFORE markdown
     * normalization — the parser tolerates the original fence formatting. */
    const { cleanedReply, suggestions } = extractTripSuggestionsFromReply(result.text);
    const { markdownInput, requestKind } = finalizeTripAssistantReply(cleanedReply);
    const text = formatAssistantReplyForMarkdown(markdownInput);
    return NextResponse.json({
      reply: text,
      ...(requestKind ? { requestKind } : {}),
      ...(suggestions.length > 0 ? { suggestions } : {}),
      provider: "anthropic" as const,
      model: anthropicModel(),
    });
```

The fenced block is extracted **before** markdown normalization so
`extractTripSuggestionsFromReply` can find the literal triple-backtick
block. The cleaned reply (without the fence and without the `##…##`
trailing marker) is what gets shown to the user.

---

## 6. Parsing & validating the fenced block

`extractTripSuggestionsFromReply` is intentionally forgiving — it returns
an empty list rather than throwing on malformed payloads, so a bad
suggestion never breaks the chat experience:

```840:867:lib/tripAssistantSuggestionSchema.ts
export function extractTripSuggestionsFromReply(replyText: string): {
  cleanedReply: string;
  suggestions: TripRecommendation[];
} {
  if (!replyText) return { cleanedReply: replyText, suggestions: [] };

  const nowIso = new Date().toISOString();
  const suggestions: TripRecommendation[] = [];
  const matches = [...replyText.matchAll(TRIP_SUGGESTIONS_FENCE_RE)];
  for (const m of matches) {
    const parsed = parseFencedJson(m[1] ?? "");
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const rec = readRecommendation(entry, nowIso);
      if (rec) suggestions.push(rec);
    }
  }

  const cleanedReply = matches.length === 0
    ? replyText
    : replyText
        .replace(TRIP_SUGGESTIONS_FENCE_RE, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

  return { cleanedReply, suggestions };
}
```

Validation layers:

- `parseFencedJson` tolerates trailing prose by retrying with the substring
  between the first `[` and the last `]`.
- `readRecommendation` enforces `kind ∈ {"stay","transit","activity"}` and
  recurses into the options:
  - `readOption` validates the interval, fills `id` with `newId()` when
    missing, and accepts `label`/`note`/`destinations[]`.
  - `readStayInterval` / `readTransitInterval` / `readActivityInterval`
    validate the discriminator, ISO times, and enum fields (`stayType`,
    `transitType`, `activityType` — falling back to `"other"`).
  - `readActivityRecommendationOption` also picks up `hostStayStepId`.
- `safeMoney`, `safeBooking`, `safeAttachments`, `safeCoords`, and
  `safeDestinations` strictly type-check sub-objects (length caps included
  to avoid LLM-poisoned strings).
- Server-managed fields are always derived locally:
  - `id ?? newId()`
  - `createdAt ?? nowIso`

The same parser is reused for **thread sync** via
`parseTripRecommendationsFromJsonString(rawJson, fallbackCreatedAtIso)`,
which is how peers reconstruct a trip’s queue from the shared assistant
thread (see §9).

---

## 7. Persistence on the trip

When the client receives a response with `suggestions[]`, it calls back into
the dock:

```358:373:lib/agent/useTripAssistant.ts
        const suggestions =
          Array.isArray(data.suggestions) && data.suggestions.length > 0 ? data.suggestions : [];

        if (suggestions.length > 0 && opts.onAddRecommendations) {
          try {
            await opts.onAddRecommendations(opts.trip, suggestions);
          } catch (err) {
            ...
            setLines((prev) => prev.slice(0, -1));
            return;
          }
        }
```

`SmartDock` wires `onAddRecommendations` to `persistTrip`:

```202:211:components/agent/SmartDock.tsx
  const onAddRecommendations = useCallback(
    async (baseTrip: Trip, recs: TripRecommendation[]) => {
      let next = baseTrip;
      for (const rec of recs) {
        next = addTripRecommendation(next, rec);
      }
      await persistTrip(next);
    },
    [persistTrip]
  );
```

`addTripRecommendation` is a thin immutable insert:

```50:56:lib/tripRecommendations.ts
export function addTripRecommendation(trip: Trip, rec: TripRecommendation): Trip {
  return {
    ...trip,
    recommendations: [...(trip.recommendations ?? []), rec],
    updatedAt: new Date().toISOString(),
  };
}
```

After the trip is persisted, the assistant’s turn (with the **raw fenced
JSON** copied verbatim into `recommendationsJson`) is also appended to the
shared thread, so collaborators converge on the same queue:

```374:393:lib/agent/useTripAssistant.ts
        const recommendationsJson =
          suggestions.length > 0 ? JSON.stringify(suggestions).slice(0, 25000) : undefined;

        if (opts.canPersistMemory && opts.userEmail?.trim()) {
          ...
          await Promise.all([
            appendSharedTripThreadTurn({
              tripId: opts.trip.id,
              fromEmailLower,
              ...,
              userContent: text,
              agentContent: reply,
              sentAtMs: contextAtMs,
              tripContextNote: where.summary,
              ...(requestKind ? { requestKind } : {}),
              ...(recommendationsJson ? { recommendationsJson } : {}),
            }),
          ]);
```

The server route enforces capping (`slice(0, 25000)`) and trip membership
via `canonicalTripDocReadableByUser`, then writes the `(user, agent)` pair
into `trips/{tripId}/assistantThread`:

```141:144:app/api/chat/shared-trip-thread-append/route.ts
  const recommendationsJson =
    typeof body.recommendationsJson === "string" && body.recommendationsJson.trim()
      ? body.recommendationsJson.trim().slice(0, 25000)
      : undefined;
```

```176:187:app/api/chat/shared-trip-thread-append/route.ts
  const agentEntry: SharedTripThreadEntry = {
    tripId,
    role: "assistant",
    from: "agent",
    content: agentContent.slice(0, 8000),
    kind: "message",
    active: true,
    createdAtMs: t1,
    ...(ctxNote ? { tripContext: ctxNote } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(recommendationsJson ? { recommendationsJson } : {}),
  };
```

It also fires a Pusher push (`notifySharedTripThreadUpdated`) so other
clients pull fresh entries quickly.

---

## 8. Cross-device / cross-collaborator sync

Two listeners cooperate to keep every device’s `trip.recommendations`
identical without making `appendSharedTripThreadTurn` do trip writes:

1. **Shared thread subscription** (`subscribeSharedTripThreadShared`):
   polls `GET /api/chat/shared-trip-thread` (Admin-backed) every ~2.8s,
   accelerated by Pusher pushes when configured. Falls back to direct
   Firestore `onSnapshot` when the admin endpoint is unavailable.
2. **Recommendation hydrator** (`useTripThreadRecommendationsSync`):

   ```13:30:lib/trip/useTripThreadRecommendationsSync.ts
   export function useTripThreadRecommendationsSync(opts: {
     trip: Trip | null;
     threadLoaded: boolean;
     threadEntries: SharedTripThreadEntry[];
     canPersist: boolean;
     persistTrip: (next: Trip) => Promise<void>;
   }): void {
     ...
     useEffect(() => {
       const { trip, threadLoaded, threadEntries, canPersist } = opts;
       if (!trip || !threadLoaded || !canPersist) return;
       const merged = mergeAssistantThreadRecommendationsIntoTrip(trip, threadEntries);
       if (!merged) return;
       void persistRef.current(merged).catch(() => {});
     }, [opts.trip, opts.threadLoaded, opts.threadEntries, opts.canPersist]);
   }
   ```

`mergeAssistantThreadRecommendationsIntoTrip` walks every active assistant
thread entry with a `recommendationsJson` blob, parses the JSON with the
same validator the chat path uses, and adds **only the ids not already on
the trip and not tombstoned in `removedRecommendationIds`**:

```74:106:lib/tripRecommendations.ts
export function mergeAssistantThreadRecommendationsIntoTrip(
  trip: Trip,
  threadEntries: SharedTripThreadEntry[]
): Trip | null {
  ...
  const suppressed = new Set(trip.removedRecommendationIds ?? []);
  const existing = new Set((trip.recommendations ?? []).map((r) => r.id));
  let next = trip;
  let changed = false;
  const sorted = [...threadEntries]
    .filter(
      (e) =>
        e.tripId === tid &&
        e.active !== false &&
        e.role === "assistant" &&
        e.kind === "message" &&
        Boolean(e.recommendationsJson?.trim())
    )
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  for (const e of sorted) {
    const raw = e.recommendationsJson!.trim();
    const createdAtIso = new Date(e.createdAtMs).toISOString();
    const parsed = parseTripRecommendationsFromJsonString(raw, createdAtIso);
    for (const rec of parsed) {
      if (suppressed.has(rec.id) || existing.has(rec.id)) continue;
      existing.add(rec.id);
      next = addTripRecommendation(next, rec);
      changed = true;
    }
  }
  return changed ? next : null;
}
```

Net result: if Alice approves a recommendation on her phone, Bob’s laptop
sees `removedRecommendationIds` include that id and stops resurrecting it
even though the source JSON still lives in the thread.

---

## 9. Approve / Skip / Delete

All three actions are pure functions on `Trip` (no side-effects) so the
caller persists the new trip exactly once:

### Skip

Keeps the card but marks it `seen: true` and **moves it to the end** so
fresh unseen cards float to the top of the queue:

```113:124:lib/tripRecommendations.ts
export function skipTripRecommendation(trip: Trip, recommendationId: string): Trip {
  const list = trip.recommendations ?? [];
  const idx = list.findIndex((r) => r.id === recommendationId);
  if (idx === -1) return trip;
  const target = { ...list[idx], seen: true } as TripRecommendation;
  const next = [...list.slice(0, idx), ...list.slice(idx + 1), target];
  return {
    ...trip,
    recommendations: next,
    updatedAt: new Date().toISOString(),
  };
}
```

### Delete

Removes the recommendation **and** writes a tombstone so the thread sync
won’t add it back:

```58:67:lib/tripRecommendations.ts
export function removeTripRecommendation(trip: Trip, recommendationId: string): Trip {
  const list = trip.recommendations ?? [];
  if (!list.some((r) => r.id === recommendationId)) return trip;
  return {
    ...trip,
    recommendations: list.filter((r) => r.id !== recommendationId),
    ...withRemovedRecommendationQueueEntry(trip, recommendationId),
    updatedAt: new Date().toISOString(),
  };
}
```

### Approve (the interesting one)

Approving an option turns a recommendation into real itinerary state:

```402:471:lib/tripRecommendations.ts
export function approveTripRecommendationOption(
  trip: Trip,
  recommendationId: string,
  optionId: string
): Trip {
  return approveTripRecommendationOptionDetailed(trip, recommendationId, optionId).trip;
}

export function approveTripRecommendationOptionDetailed(
  trip: Trip,
  recommendationId: string,
  optionId: string
): { trip: Trip; createdStepId: string | null } {
  const rec = findRecommendation(trip, recommendationId);
  if (!rec) return { trip, createdStepId: null };
  const option = findOption(rec, optionId);
  if (!option) return { trip, createdStepId: null };

  const mergeIdx = resolveMergeStepIndex(trip, option.targetStepId, rec.kind);
  if (mergeIdx !== -1 && option.interval.intervalType === rec.kind) {
    const host =
      rec.kind === "activity" ? (option as ActivityRecommendationOption).hostStayStepId : undefined;
    return approveMergeIntervalIntoStep(
      trip, recommendationId, mergeIdx, rec.kind, option.interval, option, host
    );
  }

  const seededDestinations = mergeDestinationLists(
    trip.destinations ?? [],
    option.destinations ?? []
  );
  const order = trip.steps.length;

  let next: { step: TripStep; destinations: Destination[] };
  if (rec.kind === "stay" && option.interval.intervalType === "stay") {
    next = buildStayStepFromInterval(option.interval, order, seededDestinations);
  } else if (rec.kind === "transit" && option.interval.intervalType === "transit") {
    next = buildTransitStepFromInterval(option.interval, order, seededDestinations);
  } else if (rec.kind === "activity" && option.interval.intervalType === "activity") {
    const actOpt = option as ActivityRecommendationOption;
    next = buildActivityStepFromInterval(
      option.interval, order, seededDestinations, trip, actOpt.hostStayStepId
    );
  } else {
    /** Mismatched kind / interval — refuse silently rather than fabricating a wrong step. */
    return { trip, createdStepId: null };
  }
  ...
}
```

The function has two paths:

1. **Merge into an existing step** when `option.targetStepId` matches a
   step of the same kind. `approveMergeIntervalIntoStep` appends the
   interval into `step.stepIntervals`, then widens
   `step.startTime`/`step.endTime` to cover the new interval. Activity
   merges also fill in `hostStayStepId` when absent.

2. **Create a brand-new step** of the correct kind. Helpers
   `buildStayStepFromInterval`, `buildTransitStepFromInterval`, and
   `buildActivityStepFromInterval` materialise the right `TripStep` shape,
   register any missing `Destination` rows (auto-generated when the LLM
   left ids blank), and link transit legs (`fromStayId`, `toStayId`).

In both cases the recommendation is **removed from the queue** and its id
is tombstoned via `withRemovedRecommendationQueueEntry`. `normalizeStepOrders`
re-numbers `step.order` so the itinerary stays consistent.

If the option/kind mismatch (e.g. an "activity" recommendation whose
option carries a `transit` interval) the function silently no-ops — we
never fabricate a wrong-typed step.

---

## 10. Collaborative voting

`recommendationVotes` lets multiple travelers thumbs‑up the option they
prefer before someone approves. The model is:
- 1 vote per `(recommendationId, travelerId)` (lowercased email).
- Voting for the existing option twice removes the vote (toggle).
- Voting for a different option **replaces** the previous vote.

```483:512:lib/tripRecommendations.ts
export function toggleRecommendationVote(
  trip: Trip,
  recommendationId: string,
  optionId: string,
  travelerIdLower: string
): Trip {
  const id = travelerIdLower.trim().toLowerCase();
  ...
  const existing = list.find(
    (v) => v.recommendationId === recommendationId && v.travelerId === id
  );
  let next = list.filter(
    (v) => !(v.recommendationId === recommendationId && v.travelerId === id)
  );
  if (!existing || existing.optionId !== optionId) {
    next = [...next, { recommendationId, optionId, travelerId: id, createdAt: new Date().toISOString() }];
  }
  return { ...trip, recommendationVotes: next, updatedAt: new Date().toISOString() };
}
```

The Collab screen reads votes via `votesForOption(trip, recId, optId)` and
renders a `ThumbsUp` toggle (`components/screens/collab/CollabScreen.tsx`,
`VotingPanel`). Approving still happens on the SmartDock “Suggestions”
tab — the Collab panel is read/vote only.

---

## 11. UI surfaces

### 11.1 SmartDock — Chat tab

The chat tab is the primary entry point. The user types, sees the model’s
short conversational reply (1–3 sentences), and the structured cards
quietly land on the **Suggestions** tab (with a count badge on the trigger
button — the `Sparkles` floating action).

Key wiring:

```215:226:components/agent/SmartDock.tsx
  const assistant = useTripAssistant({
    trip,
    profilePreferences: data.profilePreferences,
    tripChatMessages: data.tripChatMessages,
    globalChatMessages: data.globalChatMessages,
    userEmail: data.userEmailLower,
    userDisplayName: data.user?.displayName?.trim() ?? null,
    isTripOwner: isOwner,
    canPersistMemory: data.canPersistMemory,
    onAddRecommendations,
    ...(viewerPingRef ? { viewerPingRef } : {}),
  });
```

The floating-button badge shows **unseen** recommendation count so the
user gets a visible nudge when the assistant adds new cards:

```78:97:components/agent/SmartDock.tsx
  const unseen = unseenTripRecommendationCount(trip);

  return (
    <FloatingTrigger
      open={open}
      onOpenChange={setOpen}
      badgeCount={unseen}
      reducedMotion={Boolean(reduce)}
    >
      ...
    </FloatingTrigger>
  );
```

### 11.2 SmartDock — Suggestions tab

Each card renders the recommendation’s `title`/`note`, an option list with
labels and per-option `note`s, a “merging into step X” hint when
`targetStepId` is set, and the three actions:

- **Approve** (per option) → `approveTripRecommendationOptionDetailed` →
  `persistTrip`.
- **Skip** (per recommendation) → `skipTripRecommendation` → `persistTrip`.
- **Delete** (per recommendation) → `removeTripRecommendation` →
  `persistTrip`.

### 11.3 Collab screen — Voting panel

Surfaces every pending recommendation grouped by `kind` (`stay` /
`transit` / `activity`) with vote counts per option and a per-user toggle.

---

## 12. Where to extend

Common modifications and where to make them:

| Goal                                                         | File(s) to touch |
|--------------------------------------------------------------|------------------|
| Add a new field to a stay/transit/activity interval          | `lib/types/trip.ts` then satisfy `ShapeRecord<…>` in `lib/tripAssistantSuggestionSchema.ts` (compile-time error guides you) and extend the corresponding `readX` parser |
| Add a new `kind` of recommendation                           | `lib/types/trip.ts` (union, option type), `lib/tripAssistantSuggestionSchema.ts` (registry + `readRecommendation` branch), `lib/tripRecommendations.ts` (approve/build helpers), `components/agent/SmartDock.tsx` (badge tone, fallback labels) |
| Change classification keywords                               | `lib/tripAssistantRequestKind.ts` (`tripAssistantUserWantsStructuredTripProposals`, `tripAssistantNeedsGlobalContext`) and/or `app/api/chat/trip-assistant-classify/route.ts` (router system prompt) |
| Tweak the prose constraints in the suggestion prompt         | `lib/tripAssistantSuggestionSchema.ts` (`buildTripRecommendationSchemaPrompt`) and the relevant strings in `lib/tripAssistantRequestKind.ts` |
| Show a new badge / sort cards differently                    | `components/agent/SmartDock.tsx` (`SuggestionsTab`, `RecommendationCard`) |
| Persist additional metadata alongside the suggestion         | `app/api/chat/shared-trip-thread-append/route.ts` (allow more fields) + parser in `lib/sharedTripThreadEntryFromRaw.ts` + consumer in `mergeAssistantThreadRecommendationsIntoTrip` |
| Change how approval edits an existing step                   | `lib/tripRecommendations.ts` (`approveMergeIntervalIntoStep`, the `widenStepTimesAfterAppend` helper) |

---

## 13. Quick reference — files

- `lib/types/trip.ts` — type definitions for `TripRecommendation`, options,
  intervals, and `RecommendationVote`.
- `lib/tripAssistantSuggestionSchema.ts` — single source of truth for the
  prompt fragment and the JSON parser/validator.
- `lib/tripAssistantRequestKind.ts` — classification markers, server
  appendix, and client booster regex.
- `lib/tripAssistantPrompt.ts` — composes the trip-assistant system prompt
  (includes the suggestion schema fragment).
- `app/api/chat/trip-assistant-classify/route.ts` — tiny LLM router
  (`general | specific | suggestions`).
- `app/api/chat/trip-assistant/route.ts` — main chat endpoint; runs
  `extractTripSuggestionsFromReply` on the LLM output.
- `lib/agent/useTripAssistant.ts` — client hook driving classification,
  the chat round-trip, persistence, and the shared-thread append.
- `lib/tripRecommendations.ts` — add/remove/skip/approve/vote helpers and
  the thread→trip merge.
- `lib/trip/useTripThreadRecommendationsSync.ts` — hydrates cards from the
  shared assistant thread for collaborators.
- `app/api/chat/shared-trip-thread-append/route.ts` — Admin-SDK append
  endpoint that stores `recommendationsJson` on the agent entry.
- `lib/sharedTripThread.ts` — Firestore + Pusher fan-out of the shared
  assistant thread.
- `components/agent/SmartDock.tsx` — floating dock with Chat / Suggestions
  / Actions tabs.
- `components/screens/collab/CollabScreen.tsx` — voting panel.
