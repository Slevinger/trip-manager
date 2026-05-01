/** Stored trip calendar date: `dd-mm-yyyy`. Time of day: `HH:mm` in separate fields. */

export type TripDateTimeParts = { date: string; time: string };

export const DD_MM_YYYY_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

const DD_MM_YYYY = DD_MM_YYYY_RE;
const HH_MM = /^(\d{2}):(\d{2})$/;
const LEGACY_YMD =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export function hasTripTime(timeStr: string): boolean {
  return timeStr.trim() !== "";
}

/** Split legacy single-field values (YYYY-MM-DD, ISO, datetime) into dd-mm-yyyy + HH:mm. */
export function isValidDdMmYyyy(s: string): boolean {
  return DD_MM_YYYY.test(s.trim());
}

export function migrateLegacyCombined(s: string): TripDateTimeParts {
  const v = s.trim();
  if (!v) return { date: "", time: "" };
  if (DD_MM_YYYY.test(v)) return { date: v, time: "" };
  const m = LEGACY_YMD.exec(v);
  if (m) {
    const yyyy = m[1];
    const mo = m[2];
    const dd = m[3];
    const date = `${dd}-${mo}-${yyyy}`;
    const time =
      m[4] != null && m[5] != null ? `${m[4]}:${m[5]}` : "";
    return { date, time };
  }
  const ms = Date.parse(v);
  if (!Number.isNaN(ms)) {
    const d = new Date(ms);
    const date = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return { date, time };
  }
  return { date: v, time: "" };
}

/** Normalize raw Firestore / form time to `HH:mm` or "". */
export function normalizeHhMm(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/.exec(t);
  if (!m) return "";
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mi = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/**
 * Build step/trip date+time from Firestore fields (supports legacy combined `startDate` only).
 */
export function splitStoredDateAndTime(
  dateRaw: unknown,
  timeRaw: unknown
): TripDateTimeParts {
  const tr = String(timeRaw ?? "").trim();
  const dr = String(dateRaw ?? "").trim();
  if (tr && HH_MM.test(normalizeHhMm(tr))) {
    const time = normalizeHhMm(tr);
    if (DD_MM_YYYY.test(dr)) return { date: dr, time };
    return { ...migrateLegacyCombined(dr), time };
  }
  return migrateLegacyCombined(dr);
}

/** Calendar local noon on `dd-mm-yyyy` (night math, auto-current day bucket). */
export function parseDdMmYyyyCalendarDate(dateStr: string): Date | null {
  const m = DD_MM_YYYY.exec(dateStr.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  const dt = new Date(year, month, day, 12, 0, 0, 0);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== year ||
    dt.getMonth() !== month ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return dt;
}

/** Local instant from stored `dd-mm-yyyy` + optional `HH:mm` (noon if time empty). */
export function instantFromParts(parts: TripDateTimeParts): Date | null {
  const d0 = parseDdMmYyyyCalendarDate(parts.date);
  if (!d0) return null;
  const t = parts.time.trim();
  if (!t) return d0;
  const tm = HH_MM.exec(normalizeHhMm(t));
  if (!tm) return d0;
  return new Date(
    d0.getFullYear(),
    d0.getMonth(),
    d0.getDate(),
    Number(tm[1]),
    Number(tm[2]),
    0,
    0
  );
}

/** Human span from start to end (e.g. `2d 5h`, `45m`). Empty if parts invalid or end ≤ start. */
export function formatTripDateTimeSpan(
  start: TripDateTimeParts,
  end: TripDateTimeParts
): string {
  const a = instantFromParts(start);
  const b = instantFromParts(end);
  if (!a || !b) return "";
  const ms = b.getTime() - a.getTime();
  if (ms <= 0) return "";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes <= 0) return "";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) {
    const hPart = hours > 0 ? ` ${hours}h` : "";
    const mPart = mins > 0 ? ` ${mins}m` : "";
    return `${days}d${hPart}${mPart}`.trim();
  }
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Span between two stored date+time rows (e.g. arrival option window). */
export function formatSpanBetweenStoredParts(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
): string {
  return formatTripDateTimeSpan(
    { date: startDate.trim(), time: startTime.trim() },
    { date: endDate.trim(), time: endTime.trim() }
  );
}

export function diffNightsInclusive(start: Date, end: Date): number {
  const msPerDay = 86400000;
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((b - a) / msPerDay));
}

export function daysInMonth(year: number, month1to12: number): number {
  if (month1to12 < 1 || month1to12 > 12) return 31;
  return new Date(year, month1to12, 0).getDate();
}

export function parseTripDdMmParts(
  dateStr: string
): { d: string; m: string; y: string } | null {
  const m = DD_MM_YYYY.exec(dateStr.trim());
  if (!m) return null;
  return { d: m[1], m: m[2], y: m[3] };
}

/** `yyyy-mm-dd` for `<input type="date">`; empty if not canonical `dd-mm-yyyy`. */
export function tripDdMmYyyyToHtmlDate(ddMmYyyy: string): string {
  const p = parseTripDdMmParts(ddMmYyyy);
  if (!p) return "";
  return `${p.y}-${p.m}-${p.d}`;
}

/** Parse `yyyy-mm-dd` from a date input into stored `dd-mm-yyyy`. */
export function htmlDateToTripDdMmYyyy(html: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(html.trim());
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Build `dd-mm-yyyy` from numeric select strings; clamps day to month length. */
export function buildTripDdMmYyyy(year: string, month: string, day: string): string {
  const ys = year.trim();
  const ms = month.trim();
  const ds = day.trim();
  if (!ys || !ms || !ds) return "";
  const y = Number(ys);
  const mo = Number(ms);
  let d = Number(ds);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || !Number.isFinite(d)) return "";
  const dim = daysInMonth(y, mo);
  d = Math.min(Math.max(1, Math.floor(d)), dim);
  return `${String(d).padStart(2, "0")}-${String(mo).padStart(2, "0")}-${String(y).padStart(4, "0")}`;
}

/**
 * Normalize typed date `d-m-yyyy` / `dd-mm-yyyy` to canonical `dd-mm-yyyy`.
 * Returns the trimmed string unchanged if it does not match that pattern.
 */
export function normalizeTripDateInput(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (!m) return s;
  const built = buildTripDdMmYyyy(m[3], m[2], m[1]);
  return built || s;
}

export function minTripDateTime(a: TripDateTimeParts, b: TripDateTimeParts): TripDateTimeParts {
  const ia = instantFromParts(a);
  const ib = instantFromParts(b);
  if (!ia) return b;
  if (!ib) return a;
  return ia.getTime() <= ib.getTime() ? a : b;
}

export function maxTripDateTime(a: TripDateTimeParts, b: TripDateTimeParts): TripDateTimeParts {
  const ia = instantFromParts(a);
  const ib = instantFromParts(b);
  if (!ia) return b;
  if (!ib) return a;
  return ia.getTime() >= ib.getTime() ? a : b;
}

/** Local wall time as stored `dd-mm-yyyy` + `HH:mm`. */
export function tripInstantToParts(inst: Date): TripDateTimeParts {
  const dd = String(inst.getDate()).padStart(2, "0");
  const mm = String(inst.getMonth() + 1).padStart(2, "0");
  const yyyy = String(inst.getFullYear());
  const hh = String(inst.getHours()).padStart(2, "0");
  const mi = String(inst.getMinutes()).padStart(2, "0");
  return { date: `${dd}-${mm}-${yyyy}`, time: `${hh}:${mi}` };
}

/** Add calendar minutes to a stored start; returns null if start is invalid. */
export function addMinutesToTripParts(
  start: TripDateTimeParts,
  minutes: number
): TripDateTimeParts | null {
  const a = instantFromParts(start);
  if (!a) return null;
  const m = Math.max(0, Math.floor(minutes));
  return tripInstantToParts(new Date(a.getTime() + m * 60_000));
}
