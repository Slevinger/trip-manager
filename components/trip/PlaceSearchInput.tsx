"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { photonLangForAppLocale } from "@/lib/places/photonLang";
import type { PlaceSearchHit } from "@/lib/places/types";

type PlaceSearchInputProps = {
  value: string;
  /** Free typing — parent should clear `coordinates` when this fires. */
  onChange: (location: string) => void;
  /** User chose a row from the dropdown — includes map-friendly coordinates. */
  onPick?: (hit: { label: string; lat: number; lng: number }) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
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
}: PlaceSearchInputProps) {
  const { t, locale } = useI18n();
  const photonLang = photonLangForAppLocale(locale);
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const inputId = idProp ?? `${reactId}-input`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<PlaceSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [fetchErr, setFetchErr] = useState(false);

  const runSearch = useCallback(async (q: string, lang: string) => {
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
        lang,
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
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || hits.length === 0) return;
    setActive((a) => Math.min(a, hits.length - 1));
  }, [hits, open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function scheduleSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runSearch(q, photonLang);
    }, DEBOUNCE_MS);
  }

  function applyHit(hit: PlaceSearchHit) {
    onChange(hit.label);
    onPick?.({ label: hit.label, lat: hit.lat, lng: hit.lng });
    setOpen(false);
    setHits([]);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-expanded={open && hits.length > 0}
        aria-controls={open && hits.length > 0 ? listboxId : undefined}
        aria-activedescendant={
          open && hits[active] ? `${listboxId}-opt-${active}` : undefined
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
          if (value.trim().length >= 2) {
            setOpen(true);
            void runSearch(value, photonLang);
          }
        }}
        onKeyDown={(e) => {
          if (!open || hits.length === 0) {
            if (e.key === "ArrowDown" && value.trim().length >= 2) {
              setOpen(true);
              void runSearch(value, photonLang);
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
            setActive((i) => (i + 1) % hits.length);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + hits.length) % hits.length);
          }
          if (e.key === "Enter") {
            e.preventDefault();
            applyHit(hits[active]);
          }
        }}
      />
      {open && value.trim().length >= 2 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-[60] mt-1 max-h-52 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {loading ? (
            <div className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t("placeSearch.loading")}
            </div>
          ) : fetchErr ? (
            <div className="px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
              {t("placeSearch.error")}
            </div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t("placeSearch.noResults")}
            </div>
          ) : (
            hits.map((hit, idx) => {
              const domId = `${listboxId}-opt-${idx}`;
              const selected = idx === active;
              return (
                <button
                  key={`${hit.id}-${idx}`}
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
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyHit(hit)}
                >
                  <span className="leading-snug">{hit.label}</span>
                </button>
              );
            })
          )}
          {!loading && !fetchErr && hits.length > 0 ? (
            <div className="border-t border-zinc-100 px-3 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
              <a
                href="https://photon.komoot.io/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {t("placeSearch.attribution")}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
