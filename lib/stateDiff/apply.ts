import type { ArrayDiff, Diff, Json, JsonObject, Path, PathSegment } from "./types";

function isPlainObject(v: Json): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cloneContainer(v: Json): Json {
  if (Array.isArray(v)) return v.slice();
  if (isPlainObject(v)) return { ...v };
  return v;
}

function setAtPath(root: Json, path: Path, value: Json): Json {
  if (path.length === 0) return value;

  const seg = path[0];
  const rest = path.slice(1);

  const base = cloneContainer(root);
  if (Array.isArray(base)) {
    const idx = seg as number;
    const next = idx >= 0 && idx < base.length ? base[idx] : null;
    (base as Json[])[idx] = setAtPath(next as Json, rest, value);
    return base;
  }

  const obj: JsonObject = isPlainObject(base) ? (base as JsonObject) : {};
  const key = String(seg);
  const next = Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null;
  obj[key] = setAtPath(next as Json, rest, value);
  return obj;
}

function deleteKeyAtPath(root: Json, path: Path): Json {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const keySeg = path[path.length - 1] as PathSegment;

  const parent = getAtPath(root, parentPath);
  if (!isPlainObject(parent)) return root;

  const nextParent = { ...parent };
  delete nextParent[String(keySeg)];
  return setAtPath(root, parentPath, nextParent);
}

function addKeyAtPath(root: Json, path: Path, value: Json): Json {
  // same as set but semantically distinct in diff
  return setAtPath(root, path, value);
}

function getAtPath(root: Json, path: Path): Json {
  let cur: any = root;
  for (const seg of path) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) cur = cur[seg as number];
    else if (typeof cur === "object") cur = cur[String(seg)];
    else return null;
  }
  return (cur ?? null) as Json;
}

function applyArrayDiff(root: Json, d: ArrayDiff): Json {
  const cur = getAtPath(root, d.path);
  if (!Array.isArray(cur)) {
    // If the current value isn't an array, treat as replacement by best-effort reconstruction.
    const rebuilt = rebuildArrayFromOps([], d);
    return setAtPath(root, d.path, rebuilt);
  }

  const rebuilt = rebuildArrayFromOps(cur as Json[], d);
  return setAtPath(root, d.path, rebuilt);
}

function rebuildArrayFromOps(current: Json[], d: ArrayDiff): Json[] {
  const idKey = d.idKey;

  const byId = new Map<string, JsonObject>();
  const order: string[] = [];

  for (const item of current) {
    if (!isPlainObject(item)) continue;
    const idVal = item[idKey];
    if (typeof idVal !== "string") continue;
    byId.set(idVal, item);
    order.push(idVal);
  }

  // removals
  for (const r of d.removed) {
    byId.delete(r.id);
    const idx = order.indexOf(r.id);
    if (idx >= 0) order.splice(idx, 1);
  }

  // additions (insert by desired index; if out-of-range, append)
  const addedSorted = d.added.slice().sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  for (const a of addedSorted) {
    if (isPlainObject(a.value)) byId.set(a.id, a.value as JsonObject);
    if (order.includes(a.id)) continue;
    const insertAt = Math.max(0, Math.min(a.index, order.length));
    order.splice(insertAt, 0, a.id);
  }

  // moves: apply as reordering operations
  // To keep deterministic behavior, apply in the provided order (already canonical from diff).
  for (const m of d.moved) {
    const fromIdx = order.indexOf(m.id);
    if (fromIdx < 0) continue;
    order.splice(fromIdx, 1);
    const toIdx = Math.max(0, Math.min(m.to, order.length));
    order.splice(toIdx, 0, m.id);
  }

  // changes: apply nested diffs to item objects
  for (const c of d.changed) {
    const curItem = byId.get(c.id);
    if (!curItem) continue;
    const updated = applyDiff(curItem, c.diffs);
    if (isPlainObject(updated)) byId.set(c.id, updated as JsonObject);
  }

  const next: Json[] = [];
  for (const id of order) {
    const v = byId.get(id);
    if (v) next.push(v);
  }
  return next;
}

export function applyDiff<T extends Json>(state: T, diffs: Diff[]): T {
  let cur: Json = state;
  for (const d of diffs) {
    switch (d.op) {
      case "set":
        cur = setAtPath(cur, d.path, d.after);
        break;
      case "delete-key":
        cur = deleteKeyAtPath(cur, d.path);
        break;
      case "add-key":
        cur = addKeyAtPath(cur, d.path, d.after);
        break;
      case "array":
        cur = applyArrayDiff(cur, d);
        break;
      default: {
        const _exhaustive: never = d;
        return cur as T;
      }
    }
  }
  return cur as T;
}

export function invertDiff(diffs: Diff[]): Diff[] {
  return diffs.map((d) => {
    switch (d.op) {
      case "set":
        return { op: "set", path: d.path, before: d.after, after: d.before };
      case "delete-key":
        return { op: "add-key", path: d.path, after: d.before };
      case "add-key":
        return { op: "delete-key", path: d.path, before: d.after };
      case "array": {
        return {
          op: "array",
          path: d.path,
          idKey: d.idKey,
          added: d.removed.map((r) => ({ id: r.id, index: r.index, value: r.value })),
          removed: d.added.map((a) => ({ id: a.id, index: a.index, value: a.value })),
          moved: d.moved.map((m) => ({ id: m.id, from: m.to, to: m.from })),
          changed: d.changed.map((c) => ({ id: c.id, diffs: invertDiff(c.diffs) })),
        };
      }
      default: {
        const _exhaustive: never = d;
        return _exhaustive;
      }
    }
  });
}

