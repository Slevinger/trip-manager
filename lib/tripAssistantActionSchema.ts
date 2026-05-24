/**
 * Schema, prompt builder, and reply parser for the `##actions##` intent.
 *
 * When the user gives imperative instructions ("add a task", "update the flight",
 * "rename the trip"), the assistant outputs a `trip-actions` fenced JSON block
 * whose body is an array of {@link TripAction} objects.  The executor in
 * `lib/tripActionExecutor.ts` applies them sequentially to produce a new Trip.
 *
 * Follow the same conventions as `tripAssistantSuggestionSchema.ts`:
 *  - All ID references must point to existing trip data from the system prompt.
 *  - Partial patches are merge-applied so only supplied fields change.
 *  - ISO 8601 datetimes with timezone offsets are required for all time fields.
 */

import { newId } from "@/lib/canonicalIds";
import type {
  ActivityStepInterval,
  ActivityType,
  Destination,
  Money,
  PackingCategory,
  StayStepInterval,
  StayType,
  TaskStatus,
  TransitStepInterval,
  TransitType,
  TripBudget,
  TripTask,
} from "@/lib/types/trip";
import {
  ACTIVITY_TYPES,
  STAY_TYPES,
  TRANSIT_TYPES,
} from "@/components/manage/stepEditorConstants";

// ---------------------------------------------------------------------------
// Action type union — exhaustive list the executor handles.
// ---------------------------------------------------------------------------

export type StepInterval = StayStepInterval | TransitStepInterval | ActivityStepInterval;

export type TripAction =
  // ── Step mutations ───────────────────────────────────────────────────────
  | { type: "update_step";     stepId: string;     patch: Record<string, unknown> }
  | { type: "remove_step";     stepId: string }
  // ── Interval mutations ──────────────────────────────────────────────────
  | { type: "update_interval"; stepId: string; intervalId: string; patch: Record<string, unknown> }
  | { type: "add_interval";    stepId: string; interval: StepInterval }
  | { type: "remove_interval"; stepId: string; intervalId: string }
  // ── Destination mutations ────────────────────────────────────────────────
  | { type: "add_destination"; destination: Destination }
  | { type: "set_destination"; destinationId: string; patch: Partial<Destination> }
  | { type: "remove_destination"; destinationId: string }
  // ── Step + optional new destinations ────────────────────────────────────
  | { type: "add_step"; step: Record<string, unknown>; destinations?: Destination[] }
  // ── Trip-level fields ────────────────────────────────────────────────────
  | { type: "update_trip"; patch: Partial<{ title: string; description: string; startDate: string; endDate: string; currency: string; budget: TripBudget }> }
  // ── Tasks ────────────────────────────────────────────────────────────────
  | { type: "add_task";    task: Omit<TripTask, "id"> }
  | { type: "update_task"; taskId: string; patch: Partial<TripTask> }
  | { type: "remove_task"; taskId: string }
  // ── Packing list ─────────────────────────────────────────────────────────
  | { type: "add_packing_items"; items: Array<{ name: string; category: PackingCategory; quantity?: number }> };

/** Fenced block tag used in prompt + parser. */
export const TRIP_ACTIONS_FENCE = "trip-actions";

const TRIP_ACTIONS_FENCE_RE = new RegExp(
  "```\\s*" + TRIP_ACTIONS_FENCE + "\\b\\s*([\\s\\S]*?)```",
  "gi"
);

/** Fallback: any fenced code block whose content starts with `[` (JSON array). */
const ANY_JSON_ARRAY_FENCE_RE = /```[a-z]*\s*(\[[\s\S]*?])\s*```/gi;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function quoteEnum(values: readonly string[]): string {
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

export function buildTripAssistantActionsSchemaPrompt(): string {
  const stayTypes   = quoteEnum(STAY_TYPES);
  const transitTypes = quoteEnum(TRANSIT_TYPES);
  const activityTypes = quoteEnum(ACTIVITY_TYPES);

  return [
    "### `##actions##` reply contract",
    "When you classify a turn as `##actions##` you MUST output:",
    "  1. A **very short** chat reply (1–2 sentences) summarising what you did.",
    `  2. EXACTLY ONE fenced JSON block tagged \`\`\`${TRIP_ACTIONS_FENCE}\`\`\` whose body is a **JSON array** \`[...]\` of TripAction objects.`,
    "",
    "**ID rules (critical):**",
    "- `stepId`, `intervalId`, `destinationId`, `taskId` MUST be real IDs taken verbatim from the trip JSON in the system prompt.",
    "- If the correct ID is ambiguous, ask ONE clarifying question, end with `##specific##`, and emit NO `trip-actions` fence.",
    "- For `add_step` / `add_destination`, generate a new UUID string for the `id` field.",
    "",
    "**Time rules:** All times must be ISO 8601 strings with timezone offset inside the trip date range.",
    "",
    "**Action shapes** (trailing `// ...` comments are docs — do NOT include in output):",
    "",
    "```jsonc",
    "// ── Step mutations ──────────────────────────────────────────────────────",
    '{ "type": "update_step", "stepId": "<existing step id>",',
    '  "patch": { "title": "...", "startTime": "...", "endTime": "...", "notes": ["..."] } }',
    "",
    '{ "type": "remove_step", "stepId": "<existing step id>" }',
    "",
    "// ── Interval mutations ─────────────────────────────────────────────────",
    '{ "type": "update_interval", "stepId": "<step id>", "intervalId": "<interval id>",',
    '  "patch": {',
    '    // StayInterval patch fields:',
    `    "intervalType": "stay", "stayType": ${stayTypes},`,
    '    "title": "...", "startTime": "...", "endTime": "...", "comment": "...",',
    '    "destinationId": "...", "location": "...", "checkInTime": "...", "checkOutTime": "...", "nights": 3,',
    '    // TransitInterval patch fields:',
    `    "transitType": ${transitTypes},`,
    '    "fromDestinationId": "...", "toDestinationId": "...", "operatorName": "...",',
    '    "departureTerminal": "...", "arrivalTerminal": "...",',
    '    // ActivityInterval patch fields:',
    `    "activityType": ${activityTypes},`,
    '    "destinationId": "..."',
    '  }',
    "}",
    "",
    '{ "type": "add_interval", "stepId": "<step id>",',
    '  "interval": {',
    '    // Must match the step type. Required fields:',
    '    "id": "<new uuid>", "title": "...", "startTime": "...", "endTime": "...",',
    `    "intervalType": "stay" | "transit" | "activity",`,
    `    "stayType": ${stayTypes},  // when intervalType="stay"`,
    `    "transitType": ${transitTypes},  // when intervalType="transit"`,
    `    "activityType": ${activityTypes}  // when intervalType="activity"`,
    "  }",
    "}",
    "",
    '{ "type": "remove_interval", "stepId": "<step id>", "intervalId": "<interval id>" }',
    "",
    "// ── Destination mutations ────────────────────────────────────────────",
    '{ "type": "add_destination",',
    '  "destination": { "id": "<new uuid>", "title": "...", "location": "...", "description": "...",',
    '                   "coordinates": { "lat": 0, "lon": 0 } }',
    "}",
    "",
    '{ "type": "set_destination", "destinationId": "<existing id>",',
    '  "patch": { "title": "...", "location": "...", "description": "..." } }',
    "",
    '{ "type": "remove_destination", "destinationId": "<existing id>" }',
    "// ONLY use when you are certain no step references this destination.",
    "",
    "// ── Step + new destinations ──────────────────────────────────────────",
    '{ "type": "add_step",',
    '  "step": {',
    '    "id": "<new uuid>", "order": 99, "title": "...", "startTime": "...", "endTime": "...",',
    `    "stepType": "stay" | "transit" | "activity",`,
    '    "targetDestinationId": "<destination id>",',
    '    "stepIntervals": []',
    '  },',
    '  "destinations": [',
    '    { "id": "<new uuid>", "title": "...", "location": "...", "description": "..." }',
    "  ]",
    "}",
    "",
    "// ── Trip-level fields ────────────────────────────────────────────────",
    '{ "type": "update_trip",',
    '  "patch": { "title": "...", "description": "...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD",',
    '             "currency": "USD",',
    '             "budget": { "totalBudget": { "amount": 5000, "currency": "USD" } } }',
    "}",
    "",
    "// ── Tasks ────────────────────────────────────────────────────────────",
    '{ "type": "add_task",',
    '  "task": { "title": "...", "status": "todo" | "in_progress" | "done" | "cancelled",',
    '            "dueDate": "YYYY-MM-DD", "relatedStepId": "<step id>", "notes": "..." }',
    "}",
    "",
    '{ "type": "update_task", "taskId": "<existing task id>",',
    '  "patch": { "title": "...", "status": "done", "notes": "..." } }',
    "",
    '{ "type": "remove_task", "taskId": "<existing task id>" }',
    "",
    "// ── Packing list ─────────────────────────────────────────────────────",
    '{ "type": "add_packing_items",',
    '  "items": [',
    '    { "name": "Sunscreen SPF 50", "category": "toiletries", "quantity": 1 },',
    '    { "name": "Hiking boots", "category": "gear" }',
    "  ]",
    "}",
    "// category must be one of: \"documents\" | \"clothes\" | \"toiletries\" | \"tech\" | \"health\" | \"gear\" | \"misc\"",
    "// Duplicates (same category + name, case-insensitive) are silently skipped.",
    "```",
    "",
    "Authoring rules:",
    "- The fenced body MUST be a top-level JSON array `[...]`.",
    "- Actions are applied in order — sequence them logically (e.g. add_destination before add_step that references it).",
    "- Only include fields you are actually changing in `patch` objects.",
    "- Never invent IDs for existing entities — copy them verbatim from the trip JSON.",
    `- The fenced block MUST be exactly tagged \`${TRIP_ACTIONS_FENCE}\`. Any other tag is ignored.`,
    "- If you cannot determine the correct action or IDs, use `##specific##` and ask instead.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reply parser
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function safeStr(v: unknown, max = 2000): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function safeNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function safeIso(v: unknown): string | undefined {
  const s = safeStr(v, 64);
  if (!s) return undefined;
  // The app stores times as local wall-clock ISO strings (no offset), using the same
  // convention as the wizard: `new Date(y, m, d, h, mi).toISOString()`.
  // Strip any timezone offset so the LLM's wall-clock digits (e.g. "13:00" from
  // "2026-06-01T13:00:00+07:00") are kept as-is and treated as local time by the
  // browser, rather than being shifted to UTC first.
  const wallClockMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(s);
  if (wallClockMatch) {
    const d = new Date(wallClockMatch[1]!); // no offset → parsed as local time
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function safeMoney(v: unknown): Money | undefined {
  if (!isRecord(v)) return undefined;
  const amount = safeNum(v.amount);
  const currency = safeStr(v.currency, 8);
  if (amount === undefined || !currency) return undefined;
  return { amount, currency };
}

function safeCoords(v: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(v)) return undefined;
  const lat = safeNum(v.lat);
  const lon = safeNum(v.lon);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}

function safeDestination(v: unknown): Destination | undefined {
  if (!isRecord(v)) return undefined;
  const id = safeStr(v.id, 80) ?? newId();
  const title = safeStr(v.title, 200) ?? "";
  const location = safeStr(v.location, 400) ?? "";
  const description = safeStr(v.description, 1000) ?? "";
  const coordinates = safeCoords(v.coordinates);
  return { id, title, location, description, ...(coordinates ? { coordinates } : {}) };
}

function safeDestinations(v: unknown): Destination[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map(safeDestination).filter((d): d is Destination => d !== undefined);
  return out.length > 0 ? out : undefined;
}

function safePatch(v: unknown): Record<string, unknown> | undefined {
  if (!isRecord(v)) return undefined;
  return v;
}

function safeTaskStatus(v: unknown): TaskStatus | undefined {
  const statuses: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];
  return typeof v === "string" && (statuses as string[]).includes(v) ? (v as TaskStatus) : undefined;
}

function safeTask(v: unknown): Omit<TripTask, "id"> | undefined {
  if (!isRecord(v)) return undefined;
  const title = safeStr(v.title, 300);
  if (!title) return undefined;
  const status = safeTaskStatus(v.status) ?? "todo";
  const task: Omit<TripTask, "id"> = { title, status };
  const dueDate = safeIso(v.dueDate);
  const relatedStepId = safeStr(v.relatedStepId, 80);
  const notes = safeStr(v.notes, 2000);
  if (dueDate) task.dueDate = dueDate;
  if (relatedStepId) task.relatedStepId = relatedStepId;
  if (notes) task.notes = notes;
  return task;
}

function safeStayType(v: unknown): StayType | undefined {
  return typeof v === "string" && (STAY_TYPES as readonly string[]).includes(v) ? (v as StayType) : undefined;
}

function safeTransitType(v: unknown): TransitType | undefined {
  return typeof v === "string" && (TRANSIT_TYPES as readonly string[]).includes(v) ? (v as TransitType) : undefined;
}

function safeActivityType(v: unknown): ActivityType | undefined {
  return typeof v === "string" && (ACTIVITY_TYPES as readonly string[]).includes(v) ? (v as ActivityType) : undefined;
}

function safeInterval(v: unknown): StepInterval | undefined {
  if (!isRecord(v)) return undefined;
  const startTime = safeIso(v.startTime);
  const endTime = safeIso(v.endTime);
  if (!startTime || !endTime) return undefined;
  const id = safeStr(v.id, 80) ?? newId();
  const title = safeStr(v.title, 200) ?? "";

  if (v.intervalType === "stay") {
    const interval: StayStepInterval = {
      id, title, startTime, endTime,
      intervalType: "stay",
      stayType: safeStayType(v.stayType) ?? "other",
    };
    const destinationId = safeStr(v.destinationId, 80);
    const location = safeStr(v.location, 400);
    const coordinates = safeCoords(v.coordinates);
    const checkInTime = safeIso(v.checkInTime);
    const checkOutTime = safeIso(v.checkOutTime);
    const nights = safeNum(v.nights);
    const comment = safeStr(v.comment, 4000);
    const price = safeMoney(v.price);
    if (destinationId) interval.destinationId = destinationId;
    if (location) interval.location = location;
    if (coordinates) interval.coordinates = coordinates;
    if (checkInTime) interval.checkInTime = checkInTime;
    if (checkOutTime) interval.checkOutTime = checkOutTime;
    if (nights !== undefined) interval.nights = nights;
    if (comment) interval.comment = comment;
    if (price) interval.price = price;
    return interval;
  }

  if (v.intervalType === "transit") {
    const interval: TransitStepInterval = {
      id, title, startTime, endTime,
      intervalType: "transit",
      transitType: safeTransitType(v.transitType) ?? "other",
    };
    const fromDestinationId = safeStr(v.fromDestinationId, 80);
    const toDestinationId = safeStr(v.toDestinationId, 80);
    const operatorName = safeStr(v.operatorName, 200);
    const departureTerminal = safeStr(v.departureTerminal, 200);
    const arrivalTerminal = safeStr(v.arrivalTerminal, 200);
    const comment = safeStr(v.comment, 4000);
    const price = safeMoney(v.price);
    if (fromDestinationId) interval.fromDestinationId = fromDestinationId;
    if (toDestinationId) interval.toDestinationId = toDestinationId;
    if (operatorName) interval.operatorName = operatorName;
    if (departureTerminal) interval.departureTerminal = departureTerminal;
    if (arrivalTerminal) interval.arrivalTerminal = arrivalTerminal;
    if (comment) interval.comment = comment;
    if (price) interval.price = price;
    return interval;
  }

  if (v.intervalType === "activity") {
    const interval: ActivityStepInterval = {
      id, title, startTime, endTime,
      intervalType: "activity",
      activityType: safeActivityType(v.activityType) ?? "other",
    };
    const destinationId = safeStr(v.destinationId, 80);
    const comment = safeStr(v.comment, 4000);
    const price = safeMoney(v.price);
    if (destinationId) interval.destinationId = destinationId;
    if (comment) interval.comment = comment;
    if (price) interval.price = price;
    return interval;
  }

  return undefined;
}

function safeBudget(v: unknown): TripBudget | undefined {
  if (!isRecord(v)) return undefined;
  const budget: TripBudget = {};
  const totalBudget = safeMoney(v.totalBudget);
  if (totalBudget) budget.totalBudget = totalBudget;
  if (isRecord(v.categories)) {
    const cats: TripBudget["categories"] = {};
    for (const key of ["hotels","transport","food","activities","insurance","shopping","other"] as const) {
      const m = safeMoney((v.categories as Record<string, unknown>)[key]);
      if (m) cats[key] = m;
    }
    if (Object.keys(cats).length > 0) budget.categories = cats;
  }
  return Object.keys(budget).length > 0 ? budget : undefined;
}

function parseFencedJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* */ }
  const s = trimmed.indexOf("[");
  const e = trimmed.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try { return JSON.parse(trimmed.slice(s, e + 1)); } catch { /* */ }
  }
  return null;
}

function readAction(raw: unknown): TripAction | null {
  if (!isRecord(raw)) return null;
  const type = safeStr(raw.type, 40);
  if (!type) return null;

  switch (type) {
    case "update_step": {
      const stepId = safeStr(raw.stepId, 80);
      const patch = safePatch(raw.patch);
      if (!stepId || !patch) return null;
      return { type: "update_step", stepId, patch };
    }
    case "remove_step": {
      const stepId = safeStr(raw.stepId, 80);
      if (!stepId) return null;
      return { type: "remove_step", stepId };
    }
    case "update_interval": {
      const stepId = safeStr(raw.stepId, 80);
      const intervalId = safeStr(raw.intervalId, 80);
      const patch = safePatch(raw.patch);
      if (!stepId || !intervalId || !patch) return null;
      return { type: "update_interval", stepId, intervalId, patch };
    }
    case "add_interval": {
      const stepId = safeStr(raw.stepId, 80);
      const interval = safeInterval(raw.interval);
      if (!stepId || !interval) return null;
      return { type: "add_interval", stepId, interval };
    }
    case "remove_interval": {
      const stepId = safeStr(raw.stepId, 80);
      const intervalId = safeStr(raw.intervalId, 80);
      if (!stepId || !intervalId) return null;
      return { type: "remove_interval", stepId, intervalId };
    }
    case "add_destination": {
      const destination = safeDestination(raw.destination);
      if (!destination) return null;
      return { type: "add_destination", destination };
    }
    case "set_destination": {
      const destinationId = safeStr(raw.destinationId, 80);
      const patch = safePatch(raw.patch);
      if (!destinationId || !patch) return null;
      return { type: "set_destination", destinationId, patch: patch as Partial<Destination> };
    }
    case "remove_destination": {
      const destinationId = safeStr(raw.destinationId, 80);
      if (!destinationId) return null;
      return { type: "remove_destination", destinationId };
    }
    case "add_step": {
      const step = safePatch(raw.step);
      if (!step) return null;
      const destinations = safeDestinations(raw.destinations);
      return { type: "add_step", step, ...(destinations ? { destinations } : {}) };
    }
    case "update_trip": {
      const patch = safePatch(raw.patch);
      if (!patch) return null;
      type TripPatch = Extract<TripAction, { type: "update_trip" }>["patch"];
      const p: TripPatch = {};
      const title = safeStr(patch.title, 300);
      const description = safeStr(patch.description, 4000);
      const startDate = safeIso(patch.startDate);
      const endDate = safeIso(patch.endDate);
      const currency = safeStr(patch.currency, 8);
      const budget = safeBudget(patch.budget);
      if (title) p.title = title;
      if (description) p.description = description;
      if (startDate) p.startDate = startDate;
      if (endDate) p.endDate = endDate;
      if (currency) p.currency = currency;
      if (budget) p.budget = budget;
      if (Object.keys(p).length === 0) return null;
      return { type: "update_trip", patch: p };
    }
    case "add_task": {
      const task = safeTask(raw.task);
      if (!task) return null;
      return { type: "add_task", task };
    }
    case "update_task": {
      const taskId = safeStr(raw.taskId, 80);
      const patch = safePatch(raw.patch);
      if (!taskId || !patch) return null;
      const safePt: Partial<TripTask> = {};
      const title = safeStr(patch.title, 300);
      const status = safeTaskStatus(patch.status);
      const dueDate = safeIso(patch.dueDate);
      const notes = safeStr(patch.notes, 2000);
      if (title) safePt.title = title;
      if (status) safePt.status = status;
      if (dueDate) safePt.dueDate = dueDate;
      if (notes) safePt.notes = notes;
      if (Object.keys(safePt).length === 0) return null;
      return { type: "update_task", taskId, patch: safePt };
    }
    case "remove_task": {
      const taskId = safeStr(raw.taskId, 80);
      if (!taskId) return null;
      return { type: "remove_task", taskId };
    }
    case "add_packing_items": {
      if (!Array.isArray(raw.items)) return null;
      const PACKING_CATEGORIES = new Set<string>(["documents","clothes","toiletries","tech","health","gear","misc"]);
      const items = (raw.items as unknown[]).flatMap((it): Array<{ name: string; category: PackingCategory; quantity?: number }> => {
        if (!isRecord(it)) return [];
        const name = safeStr(it.name, 300);
        const category = safeStr(it.category, 40);
        if (!name || !category || !PACKING_CATEGORIES.has(category)) return [];
        const quantity = safeNum(it.quantity);
        return [{ name, category: category as PackingCategory, ...(quantity !== undefined ? { quantity } : {}) }];
      });
      if (items.length === 0) return null;
      return { type: "add_packing_items", items };
    }
    default:
      return null;
  }
}

/**
 * Pulls every `trip-actions` fenced block out of `replyText`, validates each
 * action, and returns the cleaned reply plus typed actions.
 * Never throws — malformed entries are silently dropped.
 */
export function extractTripActionsFromReply(replyText: string): {
  cleanedReply: string;
  actions: TripAction[];
} {
  if (!replyText) return { cleanedReply: replyText, actions: [] };

  const actions: TripAction[] = [];

  // Primary: look for the exact trip-actions fence.
  const primaryMatches = [...replyText.matchAll(TRIP_ACTIONS_FENCE_RE)];
  for (const m of primaryMatches) {
    const parsed = parseFencedJson(m[1] ?? "");
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const action = readAction(entry);
      if (action) actions.push(action);
    }
  }

  // Fallback: if no trip-actions fence found, try any JSON-array code block.
  // The LLM sometimes wraps valid actions in ```json instead of ```trip-actions.
  // Guard: the first element must have a "type" field matching a known action type —
  // this prevents accidentally grabbing suggestion arrays or other JSON.
  const KNOWN_ACTION_TYPES = new Set([
    "update_step", "remove_step", "update_interval", "add_interval", "remove_interval",
    "add_destination", "set_destination", "remove_destination",
    "add_step", "update_trip",
    "add_task", "update_task", "remove_task",
    "add_packing_items",
  ]);
  if (primaryMatches.length === 0) {
    for (const m of replyText.matchAll(ANY_JSON_ARRAY_FENCE_RE)) {
      const parsed = parseFencedJson(m[1] ?? "");
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      const firstType = isRecord(parsed[0]) ? safeStr((parsed[0] as Record<string, unknown>).type, 40) : undefined;
      if (!firstType || !KNOWN_ACTION_TYPES.has(firstType)) continue;
      const candidate: TripAction[] = [];
      for (const entry of parsed) {
        const action = readAction(entry);
        if (action) candidate.push(action);
      }
      if (candidate.length > 0) {
        actions.push(...candidate);
        break; // take first valid array only
      }
    }
  }

  const usedPrimary = primaryMatches.length > 0;
  const cleanedReply = usedPrimary
    ? replyText
        .replace(TRIP_ACTIONS_FENCE_RE, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : actions.length > 0
    ? replyText
        .replace(ANY_JSON_ARRAY_FENCE_RE, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : replyText;

  return { cleanedReply, actions };
}
