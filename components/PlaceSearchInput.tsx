"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/lib/i18n/context";
import type { TripPlacePick } from "@/lib/tripLocationCatalog";
import type { PlaceSearchHit, PlaceSearchPickPayload } from "@/lib/places/types";

type PlaceSearchInputProps = {
  value: string;
  /** Free typing — parent should clear `coordinates` when this fires. */
  onChange: (location: string) => void;
  /** User chose a row from the dropdown — includes map-friendly coordinates when available. */
  onPick?: (hit: PlaceSearchPickPayload) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  /** BCP-47 language for Google Places + Photon hints; defaults to the app locale from {@link useI18n}. */
  lang?: string;
  /** Trip places shown first; tap or pick without typing. Merged with Photon when query is 2+ chars. */
  localPicks?: TripPlacePick[];
  /** When no trip row matches, show “Create new destination…” (needs {@link onRequestCreateDestination}). */
  allowCreateDestination?: boolean;
  /** Opens parent UI to add a new registry destination (e.g. map dialog). */
  onRequestCreateDestination?: (query: string) => void;
  /** Appended to the suggestions panel (e.g. `z-[90]` inside modals so the list isn’t clipped). */
  listboxClassName?: string;
};

const DEBOUNCE_MS = 280;

export function PlaceSearchInput({
  value,
  onChange,
  onPick,
  placeholder,
  className,
  disabled,
  id: idProp,
  autoFocus,
  lang,
  localPicks,
  allowCreateDestination,
  onRequestCreateDestination,
  listboxClassName,
}: PlaceSearchInputProps) {
  const { t, locale } = useI18n();
  const searchLang = (lang ?? locale).toLowerCase();
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const inputId = idProp ?? `${reactId}-input`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<PlaceSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [fetchErr, setFetchErr] = useState(false);

  const localFiltered = useMemo(() => {
    if (!localPicks?.length) return [];
    const q = value.trim().toLowerCase();
    if (!q) return localPicks.slice(0, 24);
    return localPicks
      .filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          (p.headline && p.headline.toLowerCase().includes(q)) ||
          (p.subtitle && p.subtitle.toLowerCase().includes(q))
      )
      .slice(0, 24);
  }, [localPicks, value]);

  const hasRemoteQuery = value.trim().length >= 2;
  const tripRowCount = localFiltered.length;
  const googleHits = useMemo(
    () => hits.filter((h) => h.provider === "google"),
    [hits]
  );
  const photonHits = useMemo(
    () => hits.filter((h) => h.provider !== "google"),
    [hits]
  );
  const remoteRowCount = hasRemoteQuery ? hits.length : 0;
  const noTripMatches = value.trim().length >= 1 && tripRowCount === 0;
  const remoteSettledNoHits =
    !hasRemoteQuery || (!loading && hits.length === 0);
  const showCreateRow = Boolean(
    allowCreateDestination &&
      onRequestCreateDestination &&
      noTripMatches &&
      remoteSettledNoHits
  );
  const baseRowCount = tripRowCount + remoteRowCount;
  const rowCount = baseRowCount + (showCreateRow ? 1 : 0);
  const showDropdown =
    open &&
    (tripRowCount > 0 ||
      (hasRemoteQuery && (loading || fetchErr || hits.length > 0)) ||
      showCreateRow);

  const runSearch = useCallback(async (q: string) => {
    const token = ++seqRef.current;
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      setFetchErr(false);
      return;
    }
    setLoading(true);
    setFetchErr(false);
    try {
      const params = new URLSearchParams({
        q: q.trim(),
        lang: searchLang,
      });
      const res = await fetch(`/api/places/search?${params}`, { method: "GET" });
      const data = (await res.json()) as { results?: PlaceSearchHit[] };
      if (token !== seqRef.current) return;
      setHits(Array.isArray(data.results) ? data.results : []);
      if (!res.ok) setFetchErr(true);
    } catch {
      if (token !== seqRef.current) return;
      setHits([]);
      setFetchErr(true);
    } finally {
      if (token === seqRef.current) setLoading(false);
    }
  }, [searchLang]);

  useEffect(() => {
    if (value.trim().length < 2) {
      setHits([]);
      setFetchErr(false);
      setLoading(false);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || rowCount === 0) return;
    setActive((a) => Math.min(a, rowCount - 1));
  }, [rowCount, open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const scheduleSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void runSearch(q);
      }, DEBOUNCE_MS);
    },
    [runSearch]
  );

  /** Re-query remote providers when UI language changes (same typed query). */
  useEffect(() => {
    const q = valueRef.current.trim();
    if (q.length < 2) return;
    scheduleSearch(valueRef.current);
  }, [searchLang, scheduleSearch]);

  function applyRemoteHit(hit: PlaceSearchHit) {
    onChange(hit.label);
    onPick?.({ label: hit.label, lat: hit.lat, lng: hit.lng });
    setOpen(false);
    setHits([]);
  }

  function applyRowIndex(idx: number) {
    if (idx < tripRowCount) {
      const p = localFiltered[idx];
      if (!p) return;
      onChange(p.label);
      onPick?.({
        label: p.label,
        ...(p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : {}),
        ...(p.headline ? { title: p.headline } : {}),
        ...(p.subtitle ? { description: p.subtitle } : {}),
        ...(p.destinationId ? { destinationId: p.destinationId } : {}),
      });
      setOpen(false);
      setHits([]);
      return;
    }
    if (idx < baseRowCount) {
      const hit = hits[idx - tripRowCount];
      if (hit) applyRemoteHit(hit);
      return;
    }
    if (showCreateRow && idx === baseRowCount) {
      onRequestCreateDestination?.(value.trim());
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && active < rowCount ? `${listboxId}-opt-${active}` : undefined
        }
        aria-autocomplete="list"
        role="combobox"
        placeholder={placeholder}
        className={className}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          setOpen(true);
          setActive(0);
          scheduleSearch(v);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(0);
          if (value.trim().length >= 2) {
            void runSearch(value);
          }
        }}
        onKeyDown={(e) => {
          if (!open || rowCount === 0) {
            if (
              e.key === "ArrowDown" &&
              (localFiltered.length > 0 ||
                value.trim().length >= 2 ||
                (allowCreateDestination && onRequestCreateDestination && value.trim().length >= 1))
            ) {
              setOpen(true);
              setActive(0);
              if (value.trim().length >= 2) void runSearch(value);
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % rowCount);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + rowCount) % rowCount);
          }
          if (e.key === "Enter") {
            e.preventDefault();
            applyRowIndex(active);
          }
        }}
      />
      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className={`absolute z-[60] mt-1 max-h-52 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900${listboxClassName ? ` ${listboxClassName}` : ""}`}
        >
          {localFiltered.length > 0 ? (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                This trip
              </div>
              {localFiltered.map((p, i) => {
                const idx = i;
                const selected = active === idx;
                const domId = `${listboxId}-opt-${idx}`;
                return (
                  <button
                    key={p.id}
                    id={domId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={
                      selected
                        ? "flex w-full flex-col gap-0.5 px-3 py-2.5 text-start text-zinc-900 bg-violet-50 dark:bg-violet-950/50 dark:text-zinc-50"
                        : "flex w-full flex-col gap-0.5 px-3 py-2.5 text-start text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => applyRowIndex(idx)}
                  >
                    {p.headline ? (
                      <>
                        <span className="leading-snug font-medium text-zinc-900 dark:text-zinc-50">
                          {p.headline}
                        </span>
                        <span className="text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
                          {p.label}
                        </span>
                        {p.subtitle ? (
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{p.subtitle}</span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="leading-snug font-medium">{p.label}</span>
                        {p.subtitle ? (
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{p.subtitle}</span>
                        ) : null}
                      </>
                    )}
                  </button>
                );
              })}
            </>
          ) : null}

          {hasRemoteQuery ? (
            <>
              {localFiltered.length > 0 ? (
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              ) : null}
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Address search
              </div>
              {loading ? (
                <div className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">{t("place.searching")}</div>
              ) : fetchErr ? (
                <div className="px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
                  Search failed. Try again.
                </div>
              ) : hits.length === 0 && localFiltered.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">{t("place.noResults")}</div>
              ) : (
                <>
                  {googleHits.length > 0 ? (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                        Google addresses
                      </div>
                      {googleHits.map((hit, j) => {
                        const idx = localFiltered.length + j;
                        const selected = active === idx;
                        const domId = `${listboxId}-opt-${idx}`;
                        return (
                          <button
                            key={`${hit.id}-g-${j}`}
                            id={domId}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={
                              selected
                                ? "flex w-full px-3 py-2.5 text-start text-zinc-900 bg-violet-50 dark:bg-violet-950/50 dark:text-zinc-50"
                                : "flex w-full px-3 py-2.5 text-start text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            }
                            onMouseEnter={() => setActive(idx)}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => applyRowIndex(idx)}
                          >
                            <span className="leading-snug">{hit.label}</span>
                          </button>
                        );
                      })}
                    </>
                  ) : null}
                  {photonHits.length > 0 ? (
                    <>
                      {googleHits.length > 0 ? (
                        <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                      ) : null}
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                        OpenStreetMap
                      </div>
                      {photonHits.map((hit, j) => {
                        const idx = localFiltered.length + googleHits.length + j;
                        const selected = active === idx;
                        const domId = `${listboxId}-opt-${idx}`;
                        return (
                          <button
                            key={`${hit.id}-p-${j}`}
                            id={domId}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={
                              selected
                                ? "flex w-full px-3 py-2.5 text-start text-zinc-900 bg-violet-50 dark:bg-violet-950/50 dark:text-zinc-50"
                                : "flex w-full px-3 py-2.5 text-start text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            }
                            onMouseEnter={() => setActive(idx)}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => applyRowIndex(idx)}
                          >
                            <span className="leading-snug">{hit.label}</span>
                          </button>
                        );
                      })}
                    </>
                  ) : null}
                </>
              )}
              {!loading && !fetchErr && hits.length > 0 ? (
                <div className="space-y-1 border-t border-zinc-100 px-3 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  {googleHits.length > 0 ? (
                    <p>
                      Powered by{" "}
                      <a
                        href="https://developers.google.com/maps/documentation/places/web-service/overview"
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Google
                      </a>
                      . Use is subject to the Google Maps Platform terms.
                    </p>
                  ) : null}
                  {photonHits.length > 0 ? (
                    <p>
                      <a
                        href="https://photon.komoot.io/"
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        OpenStreetMap
                      </a>{" "}
                      via Photon.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : localFiltered.length > 0 ? (
            <div className="border-t border-zinc-100 px-3 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
              Type 2+ letters to search the map for a new place.
            </div>
          ) : null}

          {showCreateRow ? (
            <>
              {tripRowCount > 0 || hasRemoteQuery ? (
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              ) : null}
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Trip registry
              </div>
              <button
                id={`${listboxId}-opt-${baseRowCount}`}
                type="button"
                role="option"
                aria-selected={active === baseRowCount}
                className={
                  active === baseRowCount
                    ? "flex w-full flex-col gap-0.5 px-3 py-2.5 text-start text-zinc-900 bg-violet-50 dark:bg-violet-950/50 dark:text-zinc-50"
                    : "flex w-full flex-col gap-0.5 px-3 py-2.5 text-start text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }
                onMouseEnter={() => setActive(baseRowCount)}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => applyRowIndex(baseRowCount)}
              >
                <span className="leading-snug font-medium">{t("place.createNewDestination")}</span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Use map and details for “{value.trim()}”
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
