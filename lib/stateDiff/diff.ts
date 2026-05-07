import {
  defaultDiffOptions,
  type Diff,
  type DiffOptions,
  type Json,
  type JsonObject,
  type Path,
} from "./types";

function isPrimitive(v: Json): v is null | boolean | number | string {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: Json): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pathStartsWith(path: Path, prefix: Path): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

function shouldIgnore(path: Path, ignorePaths: Path[]): boolean {
  return ignorePaths.some((p) => pathStartsWith(path, p));
}

function stableObjectKeys(o: JsonObject): string[] {
  return Object.keys(o).sort((a, b) => a.localeCompare(b));
}

function detectIdArray(arr: Json[], idKey: string): boolean {
  if (arr.length === 0) return false;
  for (const v of arr) {
    if (!isPlainObject(v)) return false;
    const idVal = (v as JsonObject)[idKey];
    if (typeof idVal !== "string") return false;
  }
  return true;
}

function getId(v: JsonObject, idKey: string): string {
  const id = v[idKey];
  return typeof id === "string" ? id : "";
}

export function diffJson(before: Json, after: Json, options?: DiffOptions): Diff[] {
  const opts = { ...defaultDiffOptions, ...(options ?? {}) };
  const ignorePaths = options?.ignorePaths ?? opts.ignorePaths;

  const isIdArrayPath =
    options?.isIdArrayPath ??
    ((path: Path, b: Json[], a: Json[]) => detectIdArray(b, opts.idKey) && detectIdArray(a, opts.idKey));

  const out: Diff[] = [];

  const walk = (b: Json, a: Json, path: Path) => {
    if (shouldIgnore(path, ignorePaths)) return;

    if (isPrimitive(b) || isPrimitive(a)) {
      if (b !== a) out.push({ op: "set", path, before: b, after: a });
      return;
    }

    if (Array.isArray(b) || Array.isArray(a)) {
      if (!Array.isArray(b) || !Array.isArray(a)) {
        out.push({ op: "set", path, before: b, after: a });
        return;
      }

      const treatAsIdArray = isIdArrayPath(path, b, a);
      if (!treatAsIdArray) {
        // Scalar arrays or unknown arrays are treated atomically.
        if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ op: "set", path, before: b, after: a });
        return;
      }

      const idKey = opts.idKey;
      const beforeById = new Map<string, { index: number; value: JsonObject }>();
      const afterById = new Map<string, { index: number; value: JsonObject }>();

      b.forEach((v, index) => {
        const o = v as JsonObject;
        beforeById.set(getId(o, idKey), { index, value: o });
      });
      a.forEach((v, index) => {
        const o = v as JsonObject;
        afterById.set(getId(o, idKey), { index, value: o });
      });

      const removed: { id: string; index: number; value: Json }[] = [];
      const added: { id: string; index: number; value: Json }[] = [];
      const moved: { id: string; from: number; to: number }[] = [];
      const changed: { id: string; diffs: Diff[] }[] = [];

      for (const [id, entry] of beforeById) {
        if (!afterById.has(id)) removed.push({ id, index: entry.index, value: entry.value });
      }
      for (const [id, entry] of afterById) {
        if (!beforeById.has(id)) added.push({ id, index: entry.index, value: entry.value });
      }

      for (const [id, bEntry] of beforeById) {
        const aEntry = afterById.get(id);
        if (!aEntry) continue;
        if (bEntry.index !== aEntry.index) moved.push({ id, from: bEntry.index, to: aEntry.index });

        const subDiffs: Diff[] = [];
        // Walk children with their own output buffer to keep canonical nesting.
        const startLen = out.length;
        walk(bEntry.value, aEntry.value, [...path, id]);
        // Extract just the nested diffs we emitted (then remove them from top-level output).
        if (out.length > startLen) {
          subDiffs.push(...out.slice(startLen));
          out.splice(startLen, out.length - startLen);
        }
        if (subDiffs.length) changed.push({ id, diffs: subDiffs });
      }

      if (!removed.length && !added.length && !moved.length && !changed.length) return;

      removed.sort((x, y) => x.index - y.index || x.id.localeCompare(y.id));
      added.sort((x, y) => x.index - y.index || x.id.localeCompare(y.id));
      moved.sort((x, y) => x.from - y.from || x.to - y.to || x.id.localeCompare(y.id));
      changed.sort((x, y) => x.id.localeCompare(y.id));

      out.push({ op: "array", path, idKey, removed, added, moved, changed });
      return;
    }

    if (isPlainObject(b) && isPlainObject(a)) {
      const bKeys = stableObjectKeys(b);
      const aKeys = stableObjectKeys(a);
      const allKeys = Array.from(new Set([...bKeys, ...aKeys])).sort((x, y) => x.localeCompare(y));

      for (const key of allKeys) {
        const nextPath = [...path, key];
        const hasB = Object.prototype.hasOwnProperty.call(b, key);
        const hasA = Object.prototype.hasOwnProperty.call(a, key);
        if (shouldIgnore(nextPath, ignorePaths)) continue;

        if (!hasA && hasB) {
          out.push({ op: "delete-key", path: nextPath, before: b[key] });
        } else if (hasA && !hasB) {
          out.push({ op: "add-key", path: nextPath, after: a[key] });
        } else {
          walk(b[key], a[key], nextPath);
        }
      }
      return;
    }

    // Fallback for mismatched structures.
    out.push({ op: "set", path, before: b, after: a });
  };

  walk(before, after, []);
  return out;
}

