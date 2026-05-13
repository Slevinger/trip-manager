import type {
  Email,
  ImmutableMemoryEntryKind,
  SharedTripThreadEntry,
} from "@/lib/types/user";

/** Maps Firestore / Admin `data()` into a {@link SharedTripThreadEntry} or `null` if invalid. */
export function sharedTripThreadEntryFromRaw(
  tripId: string,
  raw: Record<string, unknown>
): SharedTripThreadEntry | null {
  const tid = tripId.trim();
  if (!tid) return null;

  const role =
    raw.role === "user" || raw.role === "assistant" ? (raw.role as "user" | "assistant") : null;
  const from = typeof raw.from === "string" ? (raw.from as "agent" | Email) : null;
  const content = typeof raw.content === "string" ? raw.content : "";
  const kind =
    raw.kind === "message" || raw.kind === "summary"
      ? (raw.kind as ImmutableMemoryEntryKind)
      : null;
  const active = raw.active !== false;
  const createdAtMs =
    typeof raw.createdAtMs === "number" && Number.isFinite(raw.createdAtMs) ? raw.createdAtMs : NaN;
  if (!role || !from || !kind || !Number.isFinite(createdAtMs)) return null;

  const fromDisplayName =
    typeof raw.fromDisplayName === "string" && raw.fromDisplayName.trim()
      ? raw.fromDisplayName.trim().slice(0, 120)
      : undefined;
  const tripContext =
    typeof raw.tripContext === "string" && raw.tripContext.trim()
      ? raw.tripContext.trim().slice(0, 500)
      : undefined;
  const requestKind =
    raw.requestKind === "general" ||
    raw.requestKind === "specific" ||
    raw.requestKind === "suggestions"
      ? (raw.requestKind as "general" | "specific" | "suggestions")
      : undefined;
  const evolveCountRaw = raw.evolveCount;
  const evolveCount =
    typeof evolveCountRaw === "number" && Number.isFinite(evolveCountRaw)
      ? Math.max(0, Math.floor(evolveCountRaw))
      : undefined;
  const memoryCompressed = raw.memoryCompressed === true ? true : undefined;
  const recommendationsJsonRaw = raw.recommendationsJson;
  const recommendationsJson =
    typeof recommendationsJsonRaw === "string" && recommendationsJsonRaw.trim()
      ? recommendationsJsonRaw.trim().slice(0, 25000)
      : undefined;

  const visibleToRaw = raw.visibleTo;
  const visibleTo =
    Array.isArray(visibleToRaw) && visibleToRaw.length > 0
      ? (visibleToRaw.filter((v) => typeof v === "string" && v.trim()) as string[])
      : undefined;

  const directedTo =
    typeof raw.directedTo === "string" && raw.directedTo.trim()
      ? raw.directedTo.trim().slice(0, 120)
      : undefined;

  return {
    tripId: tid,
    role,
    from,
    ...(fromDisplayName ? { fromDisplayName } : {}),
    content: content.slice(0, 8000),
    kind,
    active,
    createdAtMs,
    ...(tripContext ? { tripContext } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(recommendationsJson ? { recommendationsJson } : {}),
    ...(memoryCompressed ? { memoryCompressed } : {}),
    ...(evolveCount !== undefined ? { evolveCount } : {}),
    ...(visibleTo ? { visibleTo } : {}),
    ...(directedTo ? { directedTo } : {}),
  };
}
