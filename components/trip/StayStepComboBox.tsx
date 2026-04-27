"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StayStep } from "@/lib/types/trip";
import { stayStepOptionLabel } from "@/lib/tripStayEndpoints";
import { useI18n } from "@/components/providers/I18nProvider";

type StayStepComboBoxProps = {
  label: string;
  stays: StayStep[];
  selectedId?: string;
  /** Stays hidden from the list (e.g. the other transit endpoint). */
  excludeIds?: string[];
  placeholder: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  onSelect: (stayId: string | undefined) => void;
};

export function StayStepComboBox({
  label,
  stays,
  selectedId,
  excludeIds,
  placeholder,
  className,
  disabled,
  id: idProp,
  onSelect,
}: StayStepComboBoxProps) {
  const { t } = useI18n();
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const inputId = idProp ?? `${reactId}-input`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const candidates = useMemo(
    () => stays.filter((s) => !excluded.has(s.id)),
    [stays, excluded]
  );

  const selectedStay = useMemo(() => {
    if (!selectedId) return undefined;
    return stays.find((s) => s.id === selectedId);
  }, [stays, selectedId]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((s) =>
      stayStepOptionLabel(s).toLowerCase().includes(q)
    );
  }, [query, candidates]);

  useEffect(() => {
    if (open) return;
    setQuery(selectedStay ? stayStepOptionLabel(selectedStay) : "");
  }, [selectedId, selectedStay, open]);

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

  function applyStay(stay: StayStep) {
    onSelect(stay.id);
    setQuery(stayStepOptionLabel(stay));
    setOpen(false);
  }

  const showList = open && candidates.length > 0;

  return (
    <label className="block text-xs text-zinc-600 dark:text-zinc-300">
      <span>{label}</span>
      <div ref={wrapRef} className="relative mt-1">
        <div className="flex gap-1">
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled || candidates.length === 0}
            aria-expanded={showList}
            aria-controls={showList ? listboxId : undefined}
            aria-activedescendant={
              showList && hits[active] ? `${listboxId}-opt-${active}` : undefined
            }
            aria-autocomplete="list"
            role="combobox"
            placeholder={placeholder}
            className={className}
            value={query}
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              setOpen(true);
              setActive(0);
              const selLabel = selectedStay
                ? stayStepOptionLabel(selectedStay)
                : "";
              if (v.trim() === "" || (selectedStay && v !== selLabel)) {
                onSelect(undefined);
              }
            }}
            onFocus={() => {
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (!open || hits.length === 0) {
                if (e.key === "ArrowDown" && candidates.length > 0) {
                  setOpen(true);
                  setActive(0);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                setQuery(selectedStay ? stayStepOptionLabel(selectedStay) : "");
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
                applyStay(hits[active]);
              }
            }}
          />
          {selectedStay && !disabled ? (
            <button
              type="button"
              title={t("common.clear")}
              aria-label={t("common.clear")}
              className="shrink-0 rounded-xl border border-zinc-200 px-2.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              onClick={() => {
                onSelect(undefined);
                setQuery("");
                setOpen(false);
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        {showList ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-[100] mt-1 max-h-52 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {hits.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                {t("placeSearch.noResults")}
              </div>
            ) : (
              hits.map((stay, idx) => {
                const domId = `${listboxId}-opt-${idx}`;
                const sel = idx === active;
                return (
                  <button
                    key={stay.id}
                    id={domId}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    className={
                      sel
                        ? "flex w-full px-3 py-2.5 text-start text-zinc-900 bg-violet-50 dark:bg-violet-950/50 dark:text-zinc-50"
                        : "flex w-full px-3 py-2.5 text-start text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => applyStay(stay)}
                  >
                    <span className="leading-snug">{stayStepOptionLabel(stay)}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
      {selectedId && !stays.some((s) => s.id === selectedId) ? (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400/90">
          {t("step.transitStayMissing")}
        </p>
      ) : null}
    </label>
  );
}
