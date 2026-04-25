/** Parse YYYY-MM-DD as local calendar date (noon anchor avoids DST edge). */
export function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function diffNightsInclusive(start: Date, end: Date): number {
  const msPerDay = 86400000;
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((b - a) / msPerDay));
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function minYmd(a: string, b: string): string {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da) return b;
  if (!db) return a;
  return da <= db ? a : b;
}

export function maxYmd(a: string, b: string): string {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da) return b;
  if (!db) return a;
  return da >= db ? a : b;
}
