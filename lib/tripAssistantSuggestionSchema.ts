/**
 * Single source of truth for how the trip assistant exchanges suggestion
 * payloads with the LLM:
 *
 *   - {@link buildTripRecommendationSchemaPrompt} renders an exhaustive textual
 *     description of {@link TripRecommendation} **derived from the runtime
 *     enum arrays** (`STAY_TYPES`, `TRANSIT_TYPES`, `ACTIVITY_TYPES`,
 *     `BOOKING_STATUSES`). Add a new value to those arrays and the prompt
 *     updates automatically — no manual sync required.
 *
 *   - {@link extractTripSuggestionsFromReply} extracts and validates the
 *     fenced ```` ```trip-suggestions ```` JSON block back into typed
 *     {@link TripRecommendation}[] entries (filling missing ids / timestamps
 *     so the dock UI can render them right away).
 *
 * The fenced-block convention keeps the conversational reply human-readable
 * while still giving us a deterministic, robust place to attach structured
 * data the assistant authored on the fly.
 */

import {
  ACTIVITY_TYPES,
  STAY_TYPES,
  TRANSIT_TYPES,
} from "@/components/manage/stepEditorConstants";
import { newId } from "@/lib/canonicalIds";
import type {
  ActivityRecommendation,
  ActivityRecommendationOption,
  ActivityStepInterval,
  ActivityType,
  Attachment,
  BaseStepInterval,
  BookingInfo,
  BookingStatus,
  Coordinates,
  Destination,
  Money,
  StayRecommendation,
  StayRecommendationOption,
  StayStepInterval,
  StayType,
  TransitRecommendation,
  TransitRecommendationOption,
  TransitStepInterval,
  TransitType,
  TripRecommendation,
} from "@/lib/types/trip";

/**
 * Booking statuses are a runtime mirror of the {@link BookingStatus} union.
 * `as const satisfies readonly BookingStatus[]` makes TypeScript fail the
 * moment a status is added/removed/renamed in `lib/types/trip.ts` so the
 * prompt's enum list cannot drift out of sync.
 */
export const BOOKING_STATUSES = [
  "idea",
  "planned",
  "reserved",
  "booked",
  "cancelled",
] as const satisfies readonly BookingStatus[];

/** Runtime mirror of `Attachment["type"]` (drives the prompt enum + parser). */
export const ATTACHMENT_TYPES = [
  "booking",
  "ticket",
  "passport",
  "insurance",
  "other",
] as const satisfies readonly NonNullable<Attachment["type"]>[];

/** Runtime mirror of `TripRecommendation["kind"]`. */
const TRIP_RECOMMENDATION_KINDS = ["stay", "transit", "activity"] as const satisfies
  readonly TripRecommendation["kind"][];

/** Fenced block tag used in both directions (prompt + reply parser). */
export const TRIP_SUGGESTIONS_FENCE = "trip-suggestions";

const TRIP_SUGGESTIONS_FENCE_RE = new RegExp(
  "```\\s*" + TRIP_SUGGESTIONS_FENCE + "\\b\\s*([\\s\\S]*?)```",
  "gi"
);

// ----------------------------------------------------------------------------
// FIELD SPEC REGISTRY — single source of truth, type-checked against
// `lib/types/trip.ts`. Adding/renaming a field on any of the underlying
// interfaces produces a TS error in this file until the prompt is updated.
// ----------------------------------------------------------------------------

interface FieldSpec {
  /**
   * Type literal as it should appear in the JSON: a primitive (`string`,
   * `number`, `boolean`), an enum union (use {@link quoteEnum}), or the name
   * of another shape declared via `renderShape` below (e.g. `"Money"`,
   * `"Destination[]"`).
   */
  type: string;
  /** One-line prose describing the field for the LLM. */
  description: string;
  /**
   * Override the auto-generated `required` / `optional` tag in the rendered
   * comment. Useful for fields that are required at the type level but the
   * server fills in (e.g. `id`, `createdAt`).
   */
  guidance?: string;
  /** Extra inline constraint hint (units, ranges, format). */
  constraint?: string;
}

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

function quoteEnum(values: readonly string[]): string {
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

const COORDINATES_FIELDS = {
  lat: {
    type: "number",
    description: "WGS84 latitude in decimal degrees.",
    constraint: "-90 .. 90",
    required: true,
  },
  lon: {
    type: "number",
    description: "WGS84 longitude in decimal degrees.",
    constraint: "-180 .. 180",
    required: true,
  },
} as const satisfies ShapeRecord<Coordinates>;

const MONEY_FIELDS = {
  amount: {
    type: "number",
    description: "Price amount in `currency` units; do not invent a value you cannot justify.",
    required: true,
  },
  currency: {
    type: "string",
    description: "ISO 4217 currency code; default to `trip.currency` unless you have a reason to differ.",
    required: true,
  },
} as const satisfies ShapeRecord<Money>;

const BOOKING_INFO_FIELDS = {
  status: {
    type: quoteEnum(BOOKING_STATUSES),
    description: "Lifecycle of the reservation for this interval.",
    required: true,
  },
  provider: { type: "string", description: "Name of the booking provider (hotel chain, airline, etc.)." },
  confirmationNumber: { type: "string", description: "Provider confirmation / PNR / reservation code." },
  bookingUrl: { type: "string", description: "Direct URL to the booking confirmation or provider page." },
  cancellationDeadline: {
    type: "string",
    description: "ISO 8601 datetime by which the booking can be cancelled without penalty.",
  },
  refundable: { type: "boolean", description: "Whether this booking is refundable." },
  notes: { type: "string", description: "Free-form notes the user wrote about the booking." },
} as const satisfies ShapeRecord<BookingInfo>;

const ATTACHMENT_FIELDS = {
  id: { type: "string", description: "Stable id for this attachment.", required: true },
  title: { type: "string", description: "Display label.", required: true },
  url: { type: "string", description: "URL where the attachment lives.", required: true },
  type: {
    type: quoteEnum(ATTACHMENT_TYPES),
    description: "Category for filtering / iconography.",
  },
} as const satisfies ShapeRecord<Attachment>;

const DESTINATION_FIELDS = {
  id: {
    type: "string",
    description: "Stable id; intervals reference this from `destinationId` / `fromDestinationId` / `toDestinationId`.",
    required: true,
  },
  title: {
    type: "string",
    description: "Short human label (place / POI name).",
    required: true,
  },
  location: {
    type: "string",
    description: "Single-line address or search string.",
    required: true,
  },
  description: {
    type: "string",
    description: "Free-form context (locality, neighborhood, why it matters).",
    required: true,
  },
  coordinates: { type: "Coordinates", description: "Map pin coordinates when known." },
} as const satisfies ShapeRecord<Destination>;

const BASE_INTERVAL_FIELDS = {
  id: { type: "string", description: "Stable id (unique within this option).", required: true },
  title: { type: "string", description: "Short human-facing headline.", required: true },
  startTime: {
    type: "string",
    description: "ISO 8601 datetime including timezone offset.",
    constraint: "must be inside trip.startDate..trip.endDate",
    required: true,
  },
  endTime: {
    type: "string",
    description: "ISO 8601 datetime including timezone offset.",
    constraint: "must be >= startTime",
    required: true,
  },
  comment: { type: "string", description: "Free-form notes about this interval (multi-line ok)." },
  price: { type: "Money", description: "Price for this interval; prefer the trip currency." },
  booking: { type: "BookingInfo", description: "Booking metadata if a reservation exists or is planned." },
  attachments: { type: "Attachment[]", description: "Pre-trip docs / tickets / links pinned to this interval." },
  obligation: { type: "Obligation", description: "Payment obligation tracking receipts for this interval's price." },
  cancellable: { type: "boolean", description: "Whether this booking can be cancelled." },
  cancellationDeadline: { type: "string", description: "ISO 8601 datetime by which cancellation must be made." },
} as const satisfies ShapeRecord<BaseStepInterval>;

type StayIntervalOwnFields = Omit<StayStepInterval, keyof BaseStepInterval>;
const STAY_INTERVAL_OWN_FIELDS = {
  intervalType: {
    type: '"stay"',
    description: "Discriminator. Must be the literal string `\"stay\"`.",
    required: true,
  },
  stayType: {
    type: quoteEnum(STAY_TYPES),
    description: "Lodging category (used for icon / grouping).",
    required: true,
  },
  destinationId: {
    type: "string",
    description: "Place this stay sits at — id from `option.destinations` or existing `trip.destinations`.",
  },
  location: { type: "string", description: "Stay-specific address text (overrides destination's location)." },
  coordinates: { type: "Coordinates", description: "Stay-specific map pin (overrides destination's coords)." },
  checkInTime: { type: "string", description: "ISO datetime the guest arrives." },
  checkOutTime: { type: "string", description: "ISO datetime the guest leaves." },
  nights: { type: "number", description: "Convenience integer; equal to whole-night span between check-in/out." },
} as const satisfies ShapeRecord<StayIntervalOwnFields>;

type TransitIntervalOwnFields = Omit<TransitStepInterval, keyof BaseStepInterval>;
const TRANSIT_INTERVAL_OWN_FIELDS = {
  intervalType: {
    type: '"transit"',
    description: "Discriminator. Must be the literal string `\"transit\"`.",
    required: true,
  },
  transitType: {
    type: quoteEnum(TRANSIT_TYPES),
    description: "Mode of transport (used for icon / grouping).",
    required: true,
  },
  fromDestinationId: {
    type: "string",
    description: "Origin place — id from `option.destinations` or `trip.destinations`.",
  },
  toDestinationId: {
    type: "string",
    description: "Destination place — id from `option.destinations` or `trip.destinations`.",
  },
  operatorName: { type: "string", description: "Carrier / company / driver name." },
  departureTerminal: { type: "string", description: "Departure terminal / gate / pickup spot." },
  arrivalTerminal: { type: "string", description: "Arrival terminal / gate / drop-off spot." },
} as const satisfies ShapeRecord<TransitIntervalOwnFields>;

type ActivityIntervalOwnFields = Omit<ActivityStepInterval, keyof BaseStepInterval>;
const ACTIVITY_INTERVAL_OWN_FIELDS = {
  intervalType: {
    type: '"activity"',
    description: "Discriminator. Must be the literal string `\"activity\"`.",
    required: true,
  },
  activityType: {
    type: quoteEnum(ACTIVITY_TYPES),
    description: "Activity flavour (used for icon / grouping).",
    required: true,
  },
  destinationId: {
    type: "string",
    description: "Where the activity happens — id from `option.destinations` or `trip.destinations`.",
  },
} as const satisfies ShapeRecord<ActivityIntervalOwnFields>;

type OptionBaseFields = Omit<StayRecommendationOption, "interval">;
const OPTION_BASE_FIELDS = {
  id: {
    type: "string",
    description: "Stable id within this recommendation.",
    guidance: "OK to omit — server fills",
    required: true,
  },
  label: {
    type: "string",
    description: "1-3 word headline shown on the option pill (defaults to `interval.title`).",
  },
  note: { type: "string", description: "Per-option rationale shown under the pill when selected." },
  destinations: {
    type: "Destination[]",
    description:
      "New registry rows referenced by this option's interval. Only include places NOT already on `trip.destinations`.",
  },
  targetStepId: {
    type: "string",
    description:
      "When appending to an existing step, that step's `id` (must match recommendation `kind`). Omit to create a new step.",
  },
  url: {
    type: "string",
    description:
      "Tripadvisor search URL for reviews and ratings. Format:\n" +
      "• Hotels/stays → https://www.tripadvisor.com/Search?q={Hotel+Name+City}\n" +
      "• Activities/tours → https://www.tripadvisor.com/Search?q={Activity+Name+City}\n" +
      "Always include the property name and city. This is the review/info link.",
  },
  bookingUrl: {
    type: "string",
    description:
      "Booking/availability URL with trip dates. Format:\n" +
      "• Hotels/stays → https://www.booking.com/searchresults.html?ss={Hotel+Name+City}&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=N&no_rooms=1\n" +
      "• Activities/tours → https://www.viator.com/search/{Activity+Name}?startDate=YYYY-MM-DD or operator booking page.\n" +
      "• Flights/transit → https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DEST+on+DATE\n" +
      "Always include the exact trip dates from the interval.",
  },
  imageUrl: {
    type: "string",
    description:
      "Direct CDN image URL for this property — obtained from the Tripadvisor listing page's og:image meta tag " +
      "(e.g. https://media-cdn.tripadvisor.com/media/photo-s/01/23/45/67/hotel-name.jpg). " +
      "Must be a real image file URL ending in .jpg, .jpeg, .webp, or .png. " +
      "Do NOT put a website homepage. Visit the Tripadvisor listing and copy the og:image URL.",
  },
  priceNote: {
    type: "string",
    description: "Human-readable price estimate, e.g. \"€120/night\", \"~$45 per person\", \"Free entry\". Be specific; use the local currency.",
  },
} as const satisfies ShapeRecord<OptionBaseFields>;

const STAY_OPTION_DISC_FIELDS = {
  interval: { type: "StayInterval", description: "Stay-shaped interval payload.", required: true },
} as const satisfies ShapeRecord<Pick<StayRecommendationOption, "interval">>;

const TRANSIT_OPTION_DISC_FIELDS = {
  interval: { type: "TransitInterval", description: "Transit-shaped interval payload.", required: true },
} as const satisfies ShapeRecord<Pick<TransitRecommendationOption, "interval">>;

const ACTIVITY_OPTION_DISC_FIELDS = {
  interval: { type: "ActivityInterval", description: "Activity-shaped interval payload.", required: true },
} as const satisfies ShapeRecord<Pick<ActivityRecommendationOption, "interval">>;

const ACTIVITY_OPTION_HOST_FIELDS = {
  hostStayStepId: {
    type: "string",
    description:
      "When this activity is tied to an existing stay segment, set to that stay step's `id` from `trip.steps` (`stepType === \"stay\"`). Omit if not anchored to a stay.",
  },
} as const satisfies ShapeRecord<Pick<ActivityRecommendationOption, "hostStayStepId">>;

type RecommendationBaseFields = Omit<StayRecommendation, "kind" | "options">;
const RECOMMENDATION_BASE_FIELDS = {
  id: {
    type: "string",
    description: "Recommendation id — assigned by the server.",
    guidance: "DO NOT SET — server fills",
    required: true,
  },
  createdAt: {
    type: "string",
    description: "ISO datetime — assigned by the server.",
    guidance: "DO NOT SET — server fills",
    required: true,
  },
  source: { type: "string", description: "Free-form provenance label, e.g. \"assistant\"." },
  title: { type: "string", description: "Headline shown on the notification card." },
  note: {
    type: "string",
    description: "1-3 sentence rationale shown above the option picker.",
  },
  seen: {
    type: "boolean",
    description: "Whether the user has reviewed this card.",
    guidance: "DO NOT SET — managed by the dock UI",
  },
  visibleTo: {
    type: "string[]",
    description: "Email list controlling visibility — assigned by the server.",
    guidance: "DO NOT SET — server fills for @private turns",
  },
} as const satisfies ShapeRecord<RecommendationBaseFields>;

const STAY_RECOMMENDATION_DISC_FIELDS = {
  kind: { type: '"stay"', description: "Discriminator.", required: true },
  options: {
    type: "StayOption[]",
    description: "1-3 options of kind \"stay\". Each option is a full alternative the user can pick.",
    required: true,
  },
} as const satisfies ShapeRecord<Pick<StayRecommendation, "kind" | "options">>;

const TRANSIT_RECOMMENDATION_DISC_FIELDS = {
  kind: { type: '"transit"', description: "Discriminator.", required: true },
  options: {
    type: "TransitOption[]",
    description: "1-3 options of kind \"transit\".",
    required: true,
  },
} as const satisfies ShapeRecord<Pick<TransitRecommendation, "kind" | "options">>;

const ACTIVITY_RECOMMENDATION_DISC_FIELDS = {
  kind: { type: '"activity"', description: "Discriminator.", required: true },
  options: {
    type: "ActivityOption[]",
    description: "1-3 options of kind \"activity\".",
    required: true,
  },
} as const satisfies ShapeRecord<Pick<ActivityRecommendation, "kind" | "options">>;

// ----------------------------------------------------------------------------
// RENDERER — turns the field-spec registries above into the prompt block.
// ----------------------------------------------------------------------------

function renderField(name: string, spec: FieldSpec, required: boolean): string {
  const tag = spec.guidance ?? (required ? "required" : "optional");
  const constraint = spec.constraint ? ` (${spec.constraint})` : "";
  return `  "${name}": ${spec.type},  // ${tag} — ${spec.description}${constraint}`;
}

/**
 * Render a labeled JSON-ish shape from one or more field-spec records. The
 * registries are processed in order, so use this to compose `BASE + OWN`
 * shapes (e.g. `BASE_INTERVAL_FIELDS` + `STAY_INTERVAL_OWN_FIELDS`).
 */
function renderShape(
  label: string,
  ...records: ReadonlyArray<Record<string, FieldSpec>>
): string {
  const lines: string[] = [];
  for (const rec of records) {
    for (const [key, spec] of Object.entries(rec)) {
      const required = (spec as RequiredFieldSpec).required === true;
      lines.push(renderField(key, spec, required));
    }
  }
  return [`${label} = {`, ...lines, `}`].join("\n");
}

/**
 * Builds the system-prompt fragment that teaches the LLM how to emit a
 * `trip-suggestions` fenced block. Generated entirely from the typed
 * registries above; updating a Trip type forces a corresponding update here.
 */
export function buildTripRecommendationSchemaPrompt(): string {
  return [
    "### `##suggestions##` reply contract",
    "When you classify a turn as `##suggestions##`, you MUST produce TWO things:",
    "  1. **Very short** chat for the human (1–3 sentences: intent + one line of guidance). Do **not** paste hour-by-hour plans, markdown tables, horizontal rules, or multi-heading “articles” here — the UI ignores that for queuing.",
    `  2. EXACTLY ONE fenced JSON block tagged \`\`\`${TRIP_SUGGESTIONS_FENCE}\`\`\` whose body is a **JSON array** \`[...]\` (first non-whitespace char \`[\`) of TripRecommendation objects (one or more). That array is the **authoritative** list the app iterates as cards (approve/skip/edit); put **every** bookable idea **only** there — use **separate** array elements per distinct proposal (e.g. morning vs lunch vs dinner) and \`options[]\` for A/B/C picks within the same slot.`,
    "",
    "The shapes below are TypeScript-flavoured pseudo-JSON. The trailing `// ...`",
    "comments document required/optional + intent — do NOT include them in your output.",
    "Every shape is generated from `lib/types/trip.ts`, so they always reflect the live schema.",
    "",
    "```jsonc",
    renderShape(
      "TripRecommendation (one of StayRecommendation | TransitRecommendation | ActivityRecommendation)",
      RECOMMENDATION_BASE_FIELDS
    ),
    "",
    renderShape(
      "StayRecommendation",
      STAY_RECOMMENDATION_DISC_FIELDS,
      RECOMMENDATION_BASE_FIELDS
    ),
    "",
    renderShape(
      "TransitRecommendation",
      TRANSIT_RECOMMENDATION_DISC_FIELDS,
      RECOMMENDATION_BASE_FIELDS
    ),
    "",
    renderShape(
      "ActivityRecommendation",
      ACTIVITY_RECOMMENDATION_DISC_FIELDS,
      RECOMMENDATION_BASE_FIELDS
    ),
    "",
    renderShape("StayOption", OPTION_BASE_FIELDS, STAY_OPTION_DISC_FIELDS),
    "",
    renderShape("TransitOption", OPTION_BASE_FIELDS, TRANSIT_OPTION_DISC_FIELDS),
    "",
    renderShape(
      "ActivityOption",
      OPTION_BASE_FIELDS,
      ACTIVITY_OPTION_DISC_FIELDS,
      ACTIVITY_OPTION_HOST_FIELDS
    ),
    "",
    renderShape("StayInterval", BASE_INTERVAL_FIELDS, STAY_INTERVAL_OWN_FIELDS),
    "",
    renderShape("TransitInterval", BASE_INTERVAL_FIELDS, TRANSIT_INTERVAL_OWN_FIELDS),
    "",
    renderShape("ActivityInterval", BASE_INTERVAL_FIELDS, ACTIVITY_INTERVAL_OWN_FIELDS),
    "",
    renderShape("Destination", DESTINATION_FIELDS),
    "",
    renderShape("Coordinates", COORDINATES_FIELDS),
    "",
    renderShape("Money", MONEY_FIELDS),
    "",
    renderShape("BookingInfo", BOOKING_INFO_FIELDS),
    "",
    renderShape("Attachment", ATTACHMENT_FIELDS),
    "```",
    "",
    "Authoring rules:",
    `- Allowed kinds: ${quoteEnum(TRIP_RECOMMENDATION_KINDS)}.`,
    "- The fenced body is **only** a JSON array — never wrap it in an object key.",
    "- Each \`TripRecommendation\` MUST have **at least 3 \`options\`** of the same \`kind\`. If you cannot generate 3 genuinely distinct alternatives for a slot, omit that recommendation entirely — never pad with weak duplicates.",
    "- Output as many TripRecommendation rows as the user's ask needs (often 3–10 for a full-day menu), each with a minimum of 3 \`options\` of the same \`kind\`.",
    "- An option's `interval.intervalType` MUST equal the recommendation's `kind`.",
    "- Times must be ISO 8601 with timezone offset and inside the trip's date range.",
    "- Currency codes default to the trip currency; do not invent prices you cannot justify.",
    "- Copy **`trip.destinations[].id` strings verbatim** into interval `destinationId` / `fromDestinationId` / `toDestinationId` when the proposal is for that row.",
    "- For **`kind: \"activity\"`**, set `hostStayStepId` on each option to the matching **`trip.steps` stay step `id`** when the activity is meant while based at that stay (omit only when truly independent).",
    "- Reuse existing ids whenever a place already exists on the trip; **omit** redundant rows from `option.destinations`. Only add `option.destinations` entries for places **absent** from `trip.destinations`.",
    "- Honor every `DO NOT SET` field — those are server-managed.",
    "- Do NOT wrap the array in any other key. The fenced block's first non-whitespace char is `[`.",
    `- The fenced block MUST be exactly tagged \`${TRIP_SUGGESTIONS_FENCE}\`. Any other tag is ignored.`,
    "- If you cannot produce valid suggestions, omit the fenced block entirely and answer normally;",
    "  do NOT emit `##suggestions##` in that case (use `##general##` or `##specific##` instead).",
  ].join("\n");
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function safeString(v: unknown, max = 4000): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function safeIso(v: unknown): string | undefined {
  const s = safeString(v, 64);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : s;
}

function safeNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function safeMoney(v: unknown): Money | undefined {
  if (!isRecord(v)) return undefined;
  const amount = safeNumber(v.amount);
  const currency = safeString(v.currency, 8);
  if (amount === undefined || !currency) return undefined;
  return { amount, currency };
}

function safeBookingStatus(v: unknown): BookingStatus | undefined {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v)
    ? (v as BookingStatus)
    : undefined;
}

function safeBooking(v: unknown): BookingInfo | undefined {
  if (!isRecord(v)) return undefined;
  const status = safeBookingStatus(v.status);
  if (!status) return undefined;
  const out: BookingInfo = { status };
  const provider = safeString(v.provider, 200);
  const confirmationNumber = safeString(v.confirmationNumber, 200);
  const bookingUrl = safeString(v.bookingUrl, 600);
  const cancellationDeadline = safeIso(v.cancellationDeadline);
  const notes = safeString(v.notes, 1000);
  if (provider) out.provider = provider;
  if (confirmationNumber) out.confirmationNumber = confirmationNumber;
  if (bookingUrl) out.bookingUrl = bookingUrl;
  if (cancellationDeadline) out.cancellationDeadline = cancellationDeadline;
  if (typeof v.refundable === "boolean") out.refundable = v.refundable;
  if (notes) out.notes = notes;
  return out;
}

function safeAttachmentType(v: unknown): NonNullable<Attachment["type"]> | undefined {
  return typeof v === "string" && (ATTACHMENT_TYPES as readonly string[]).includes(v)
    ? (v as NonNullable<Attachment["type"]>)
    : undefined;
}

function safeAttachments(v: unknown): Attachment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Attachment[] = [];
  for (const row of v) {
    if (!isRecord(row)) continue;
    const id = safeString(row.id, 80);
    const title = safeString(row.title, 200);
    const url = safeString(row.url, 600);
    if (!id || !title || !url) continue;
    const type = safeAttachmentType(row.type);
    out.push({ id, title, url, ...(type ? { type } : {}) });
  }
  return out.length > 0 ? out : undefined;
}

function safeCoords(v: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(v)) return undefined;
  const lat = safeNumber(v.lat);
  const lon = safeNumber(v.lon);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}

function safeDestinations(v: unknown): Destination[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Destination[] = [];
  for (const row of v) {
    if (!isRecord(row)) continue;
    const id = safeString(row.id, 80);
    if (!id) continue;
    const title = safeString(row.title, 200) ?? "";
    const location = safeString(row.location, 400) ?? "";
    const description = safeString(row.description, 1000) ?? "";
    const coords = safeCoords(row.coordinates);
    out.push({ id, title, location, description, ...(coords ? { coordinates: coords } : {}) });
  }
  return out.length > 0 ? out : undefined;
}

/** Same key set as {@link BaseStepInterval}; using the type keeps the parser
 * locked to the canonical shape so a new base field forces a parser update. */
type BaseIntervalParsed = BaseStepInterval;

function readBaseInterval(raw: Record<string, unknown>): BaseIntervalParsed | null {
  const startTime = safeIso(raw.startTime);
  const endTime = safeIso(raw.endTime);
  if (!startTime || !endTime) return null;
  const id = safeString(raw.id, 80) ?? newId();
  const title = safeString(raw.title, 200) ?? "";
  const out: BaseIntervalParsed = { id, title, startTime, endTime };
  const comment = safeString(raw.comment, 4000);
  if (comment) out.comment = comment;
  const price = safeMoney(raw.price);
  if (price) out.price = price;
  const booking = safeBooking(raw.booking);
  if (booking) out.booking = booking;
  const attachments = safeAttachments(raw.attachments);
  if (attachments) out.attachments = attachments;
  return out;
}

function safeStayType(v: unknown): StayType | undefined {
  return typeof v === "string" && (STAY_TYPES as readonly string[]).includes(v)
    ? (v as StayType)
    : undefined;
}

function safeTransitType(v: unknown): TransitType | undefined {
  return typeof v === "string" && (TRANSIT_TYPES as readonly string[]).includes(v)
    ? (v as TransitType)
    : undefined;
}

function safeActivityType(v: unknown): ActivityType | undefined {
  return typeof v === "string" && (ACTIVITY_TYPES as readonly string[]).includes(v)
    ? (v as ActivityType)
    : undefined;
}

function readStayInterval(raw: unknown): StayStepInterval | null {
  if (!isRecord(raw) || raw.intervalType !== "stay") return null;
  const base = readBaseInterval(raw);
  if (!base) return null;
  const stayType = safeStayType(raw.stayType) ?? "other";
  const interval: StayStepInterval = {
    ...base,
    intervalType: "stay",
    stayType,
  };
  const destinationId = safeString(raw.destinationId, 80);
  const location = safeString(raw.location, 400);
  const coordinates = safeCoords(raw.coordinates);
  const checkInTime = safeIso(raw.checkInTime);
  const checkOutTime = safeIso(raw.checkOutTime);
  const nights = safeNumber(raw.nights);
  if (destinationId) interval.destinationId = destinationId;
  if (location) interval.location = location;
  if (coordinates) interval.coordinates = coordinates;
  if (checkInTime) interval.checkInTime = checkInTime;
  if (checkOutTime) interval.checkOutTime = checkOutTime;
  if (nights !== undefined) interval.nights = nights;
  return interval;
}

function readTransitInterval(raw: unknown): TransitStepInterval | null {
  if (!isRecord(raw) || raw.intervalType !== "transit") return null;
  const base = readBaseInterval(raw);
  if (!base) return null;
  const transitType = safeTransitType(raw.transitType) ?? "other";
  const interval: TransitStepInterval = {
    ...base,
    intervalType: "transit",
    transitType,
  };
  const fromDestinationId = safeString(raw.fromDestinationId, 80);
  const toDestinationId = safeString(raw.toDestinationId, 80);
  const operatorName = safeString(raw.operatorName, 200);
  const departureTerminal = safeString(raw.departureTerminal, 200);
  const arrivalTerminal = safeString(raw.arrivalTerminal, 200);
  if (fromDestinationId) interval.fromDestinationId = fromDestinationId;
  if (toDestinationId) interval.toDestinationId = toDestinationId;
  if (operatorName) interval.operatorName = operatorName;
  if (departureTerminal) interval.departureTerminal = departureTerminal;
  if (arrivalTerminal) interval.arrivalTerminal = arrivalTerminal;
  return interval;
}

function readActivityInterval(raw: unknown): ActivityStepInterval | null {
  if (!isRecord(raw) || raw.intervalType !== "activity") return null;
  const base = readBaseInterval(raw);
  if (!base) return null;
  const activityType = safeActivityType(raw.activityType) ?? "other";
  const interval: ActivityStepInterval = {
    ...base,
    intervalType: "activity",
    activityType,
  };
  const destinationId = safeString(raw.destinationId, 80);
  if (destinationId) interval.destinationId = destinationId;
  return interval;
}

function readOption<T extends StayStepInterval | TransitStepInterval | ActivityStepInterval>(
  raw: unknown,
  readInterval: (rawInterval: unknown) => T | null
): {
  id: string;
  label?: string;
  note?: string;
  destinations?: Destination[];
  interval: T;
} | null {
  if (!isRecord(raw)) return null;
  const interval = readInterval(raw.interval);
  if (!interval) return null;
  const id = safeString(raw.id, 80) ?? newId();
  const label = safeString(raw.label, 120);
  const note = safeString(raw.note, 2000);
  const destinations = safeDestinations(raw.destinations);
  const url = safeString(raw.url, 600);
  const bookingUrl = safeString(raw.bookingUrl, 600);
  const imageUrl = safeString(raw.imageUrl, 600);
  const priceNote = safeString(raw.priceNote, 120);
  return {
    id,
    interval,
    ...(label ? { label } : {}),
    ...(note ? { note } : {}),
    ...(destinations ? { destinations } : {}),
    ...(url ? { url } : {}),
    ...(bookingUrl ? { bookingUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(priceNote ? { priceNote } : {}),
  };
}

function readActivityRecommendationOption(raw: unknown): ActivityRecommendationOption | null {
  if (!isRecord(raw)) return null;
  const parsed = readOption(raw, readActivityInterval);
  if (!parsed) return null;
  const hostStayStepId = safeString(raw.hostStayStepId, 80);
  return {
    ...parsed,
    ...(hostStayStepId ? { hostStayStepId } : {}),
  } as ActivityRecommendationOption;
}

function readRecommendation(raw: unknown, nowIso: string): TripRecommendation | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.kind !== "string" ||
    !(TRIP_RECOMMENDATION_KINDS as readonly string[]).includes(raw.kind)
  ) {
    return null;
  }
  const visibleToRaw = raw.visibleTo;
  const visibleTo =
    Array.isArray(visibleToRaw) && visibleToRaw.length > 0
      ? (visibleToRaw.filter((v): v is string => typeof v === "string" && v.trim() !== "") as string[])
      : undefined;

  const baseExtras = {
    id: safeString(raw.id, 80) ?? newId(),
    createdAt: safeIso(raw.createdAt) ?? nowIso,
    ...(safeString(raw.title, 200) ? { title: safeString(raw.title, 200)! } : {}),
    ...(safeString(raw.note, 4000) ? { note: safeString(raw.note, 4000)! } : {}),
    ...(safeString(raw.source, 80) ? { source: safeString(raw.source, 80)! } : {}),
    ...(visibleTo ? { visibleTo } : {}),
  };
  const optionsRaw = Array.isArray(raw.options) ? raw.options : [];
  if (raw.kind === "stay") {
    const options: StayRecommendationOption[] = [];
    for (const opt of optionsRaw) {
      const parsed = readOption(opt, readStayInterval);
      if (parsed) options.push(parsed as StayRecommendationOption);
    }
    if (options.length < 3) return null;
    const rec: StayRecommendation = { ...baseExtras, kind: "stay", options };
    return rec;
  }
  if (raw.kind === "transit") {
    const options: TransitRecommendationOption[] = [];
    for (const opt of optionsRaw) {
      const parsed = readOption(opt, readTransitInterval);
      if (parsed) options.push(parsed as TransitRecommendationOption);
    }
    if (options.length < 3) return null;
    const rec: TransitRecommendation = { ...baseExtras, kind: "transit", options };
    return rec;
  }
  const options: ActivityRecommendationOption[] = [];
  for (const opt of optionsRaw) {
    const parsed = readActivityRecommendationOption(opt);
    if (parsed) options.push(parsed);
  }
  if (options.length < 3) return null;
  const rec: ActivityRecommendation = { ...baseExtras, kind: "activity", options };
  return rec;
}

function parseFencedJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /** Tolerate trailing prose or extra text after the JSON array. */
    const startArr = trimmed.indexOf("[");
    const endArr = trimmed.lastIndexOf("]");
    if (startArr >= 0 && endArr > startArr) {
      try {
        return JSON.parse(trimmed.slice(startArr, endArr + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Parses a JSON array string (e.g. shared-thread `recommendationsJson` snapshots)
 * into validated {@link TripRecommendation} rows. Malformed entries are skipped.
 */
export function parseTripRecommendationsFromJsonString(
  rawJson: string,
  fallbackCreatedAtIso?: string
): TripRecommendation[] {
  const nowIso = fallbackCreatedAtIso ?? new Date().toISOString();
  const parsed = parseFencedJson(rawJson);
  if (!Array.isArray(parsed)) return [];
  const out: TripRecommendation[] = [];
  for (const entry of parsed) {
    const rec = readRecommendation(entry, nowIso);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Pulls every `trip-suggestions` fenced block out of `replyText`, validates the
 * contents, and returns the cleaned conversational text plus the typed
 * recommendations. Always returns an empty array (never throws) on malformed
 * payloads — the UI degrades gracefully to a normal chat reply.
 */
export function extractTripSuggestionsFromReply(replyText: string): {
  cleanedReply: string;
  suggestions: TripRecommendation[];
} {
  if (!replyText) return { cleanedReply: replyText, suggestions: [] };

  const nowIso = new Date().toISOString();
  const suggestions: TripRecommendation[] = [];
  /** Capture every fenced block before we strip them — RegExp.matchAll keeps state safe. */
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
