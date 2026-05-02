export function notesToText(n?: string[]): string {
  return (n ?? []).join("\n");
}

export function textToNotes(t: string): string[] | undefined {
  const lines = t.split("\n").map((s) => s.trimEnd());
  const nonEmpty = lines.filter((s) => s.length > 0);
  return nonEmpty.length ? nonEmpty : undefined;
}

/** Append a picked place line to an interval `comment` (OSM / geocode audit trail). */
export function appendGeoPickComment(prev: string | undefined, line: string): string {
  const t = (prev ?? "").trim();
  return t ? `${t}\n${line}` : line;
}
