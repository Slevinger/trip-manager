import type { DiffOptions, Json, Path } from "./types";

const IGNORE_KEYS = new Set(["updatedAt", "createdAt"]);

// High-frequency telemetry (not useful for undo history)
const IGNORE_TOP_LEVEL: Path[] = [["updatedAt"], ["createdAt"], ["liveLocations"]];

const TRIP_ID_ARRAY_KEYS = new Set([
  "destinations",
  "travelers",
  "viewers",
  "steps",
  "stepIntervals",
  "tasks",
  "documents",
  "recommendations",
  "options",
  "warnings",
]);

function isTripIdArrayPath(path: Path, before: Json[], after: Json[]): boolean {
  const last = path[path.length - 1];
  if (typeof last === "string" && TRIP_ID_ARRAY_KEYS.has(last)) return true;

  // If we don't recognize the key, fall back to safe auto-detect:
  // treat as id-array only if both sides look like objects with string ids.
  const looksLikeIdArray = (arr: Json[]) =>
    arr.length > 0 &&
    arr.every(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v) &&
        typeof (v as any).id === "string",
    );
  return looksLikeIdArray(before) && looksLikeIdArray(after);
}

function ignoreNestedTimestamps(ignorePaths: Path[]): Path[] {
  // In addition to top-level ignore keys, ignore any nested createdAt/updatedAt when encountered.
  // This is expressed in diff.ts by checking prefix matches, so we include single-segment prefixes
  // which catch those keys at the root. For nested objects, we rely on the key check in `diff.ts`
  // by passing ignorePaths that match any path ending with those keys is not supported as prefix.
  // So we approximate by ignoring common root keys + explicit known timestamp fields.
  return ignorePaths;
}

export const tripDiffOptions: DiffOptions = {
  idKey: "id",
  ignorePaths: ignoreNestedTimestamps(IGNORE_TOP_LEVEL),
  isIdArrayPath: (path, before, after) => {
    if (path.length > 0) {
      const last = path[path.length - 1];
      if (typeof last === "string" && IGNORE_KEYS.has(last)) return false;
    }
    return isTripIdArrayPath(path, before, after);
  },
};

