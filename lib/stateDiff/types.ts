export type PathSegment = string | number;
export type Path = PathSegment[];

export type JsonPrimitive = null | boolean | number | string;
export type JsonObject = { [k: string]: Json };
export type Json = JsonPrimitive | Json[] | JsonObject;

export type SetDiff = {
  op: "set";
  path: Path;
  before: Json;
  after: Json;
};

export type DeleteKeyDiff = {
  op: "delete-key";
  path: Path;
  before: Json;
};

export type AddKeyDiff = {
  op: "add-key";
  path: Path;
  after: Json;
};

export type ArrayDiff = {
  op: "array";
  path: Path;
  idKey: string;
  added: { id: string; index: number; value: Json }[];
  removed: { id: string; index: number; value: Json }[];
  moved: { id: string; from: number; to: number }[];
  changed: { id: string; diffs: Diff[] }[];
};

export type Diff = SetDiff | DeleteKeyDiff | AddKeyDiff | ArrayDiff;

export type DiffOptions = {
  /**
   * The property name to match array items by (default "id").
   * Only used when the array is detected as an id-array (see `isIdArrayPath`).
   */
  idKey?: string;
  /**
   * Path prefixes to skip entirely (no diffs emitted beneath them).
   * Example: [["updatedAt"], ["liveLocations"]]
   */
  ignorePaths?: Path[];
  /**
   * Decide whether a given array path should be treated as an id-array.
   * Default: auto-detect (all elements are objects with string `idKey`).
   */
  isIdArrayPath?: (path: Path, before: Json[], after: Json[]) => boolean;
};

export const defaultDiffOptions: Required<DiffOptions> = {
  idKey: "id",
  ignorePaths: [],
  isIdArrayPath: () => false,
};

