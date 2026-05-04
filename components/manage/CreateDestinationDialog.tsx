"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { PlaceSearchInput } from "@/components/PlaceSearchInput";
import { useI18n } from "@/lib/i18n/context";
import type { Destination } from "@/lib/types/trip";
import { newId } from "@/lib/canonicalIds";
import type { PlaceSearchHit, PlaceSearchPickPayload } from "@/lib/places/types";

import "leaflet/dist/leaflet.css";

function MapClickSetPin({
  position,
  onPick,
}: {
  position: [number, number] | null;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return position ? (
    <CircleMarker
      center={position}
      radius={9}
      pathOptions={{
        color: "#5b21b6",
        weight: 2,
        fillColor: "#a78bfa",
        fillOpacity: 0.9,
      }}
    />
  ) : null;
}

const DEFAULT_CENTER: [number, number] = [20, 0];

async function fetchFirstPlaceHit(trimmed: string, lang: string): Promise<PlaceSearchHit | undefined> {
  if (trimmed.length < 2) return undefined;
  const params = new URLSearchParams({ q: trimmed, lang });
  const res = await fetch(`/api/places/search?${params}`);
  const data = (await res.json()) as { results?: PlaceSearchHit[] };
  const first = Array.isArray(data.results) ? data.results[0] : undefined;
  if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) return first;
  return undefined;
}

type CreateDestinationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seed address / search text from the field (create flow only). */
  initialQuery?: string;
  /**
   * When opening “new destination” from an external search row, pre-fills title/address/map pin
   * without re-querying (see `DestinationsInput`).
   */
  initialSearchHit?: PlaceSearchPickPayload | null;
  /** When set, edit this registry row (same id on save, map pre-filled when coords exist). */
  existingDestination?: Destination | null;
  onSave: (destination: Destination) => void | Promise<void>;
};

export function CreateDestinationDialog({
  open,
  onOpenChange,
  initialQuery = "",
  initialSearchHit = null,
  existingDestination = null,
  onSave,
}: CreateDestinationDialogProps) {
  const { locale } = useI18n();
  const placesLang = locale.toLowerCase();
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(2);
  const [mapKey, setMapKey] = useState(0);
  const [geocodeBusy, setGeocodeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const applyHitToMap = useCallback((first: PlaceSearchHit) => {
    const c: [number, number] = [first.lat, first.lng];
    setMapCenter(c);
    setMapZoom(12);
    setPin(c);
    setMapKey((k) => k + 1);
    if (first.description?.trim()) {
      setDescription((d) => d.trim() || first.description!.trim());
    }
  }, []);

  const bootstrapNewDestination = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      setTitle(trimmed ? trimmed.split(",")[0]!.trim() : "");
      setLocation(trimmed);
      setDescription(trimmed);
      setPin(null);
      setMapCenter(DEFAULT_CENTER);
      setMapZoom(2);
      if (trimmed.length < 2) return;
      setGeocodeBusy(true);
      try {
        const first = await fetchFirstPlaceHit(trimmed, placesLang);
        if (first) {
          applyHitToMap(first);
          setTitle((prev) => (prev.trim() ? prev : first.title?.trim() || prev));
        }
      } finally {
        setGeocodeBusy(false);
      }
    },
    [applyHitToMap, placesLang]
  );

  const geocodeSeedWithoutClearingFields = useCallback(
    async (seed: string) => {
      const trimmed = seed.trim();
      if (trimmed.length < 2) return;
      setGeocodeBusy(true);
      try {
        const first = await fetchFirstPlaceHit(trimmed, placesLang);
        if (first) applyHitToMap(first);
      } finally {
        setGeocodeBusy(false);
      }
    },
    [applyHitToMap, placesLang]
  );

  useEffect(() => {
    if (!open) return;
    setMapKey((k) => k + 1);
    if (existingDestination) {
      const ex = existingDestination;
      const seed = (ex.location || ex.title || ex.description || "").trim();
      setTitle((ex.title ?? "").trim() || (seed ? seed.split(",")[0]!.trim() : ""));
      setLocation((ex.location ?? "").trim() || seed);
      setDescription((ex.description ?? "").trim());
      const c = ex.coordinates;
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
        const pos: [number, number] = [c.lat, c.lon];
        setPin(pos);
        setMapCenter(pos);
        setMapZoom(13);
      } else {
        setPin(null);
        setMapCenter(DEFAULT_CENTER);
        setMapZoom(2);
        void geocodeSeedWithoutClearingFields(seed);
      }
    } else if (initialSearchHit?.label?.trim()) {
      const h = initialSearchHit;
      const loc = h.label.trim();
      setLocation(loc);
      setTitle((h.title?.trim() || loc.split(",")[0]?.trim() || "").trim());
      setDescription((h.description?.trim() || loc).trim());
      if (
        h.lat != null &&
        h.lng != null &&
        Number.isFinite(h.lat) &&
        Number.isFinite(h.lng)
      ) {
        const pos: [number, number] = [h.lat, h.lng];
        setPin(pos);
        setMapCenter(pos);
        setMapZoom(14);
      } else {
        setPin(null);
        setMapCenter(DEFAULT_CENTER);
        setMapZoom(2);
        if (loc.length >= 2) void geocodeSeedWithoutClearingFields(loc);
      }
    } else {
      void bootstrapNewDestination(initialQuery);
    }
  }, [
    open,
    initialQuery,
    initialSearchHit,
    existingDestination,
    bootstrapNewDestination,
    geocodeSeedWithoutClearingFields,
  ]);

  function onAddressPick(p: PlaceSearchPickPayload) {
    setLocation(p.label);
    if (p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      const pos: [number, number] = [p.lat, p.lng];
      setPin(pos);
      setMapCenter(pos);
      setMapZoom((z) => Math.max(z, 14));
      setMapKey((k) => k + 1);
    }
    if (p.title?.trim()) setTitle((t) => (t.trim() ? t : p.title!.trim()));
    if (p.description?.trim()) setDescription((d) => (d.trim() ? d : p.description!.trim()));
  }

  async function handleSave() {
    const loc = location.trim();
    if (!loc || !pin || saveBusy) return;
    const t = title.trim() || loc.split(",")[0]!.trim() || "Place";
    const desc = description.trim() || loc;
    const base = existingDestination;
    setSaveBusy(true);
    try {
      await Promise.resolve(
        onSave({
          ...(base ?? {}),
          id: base?.id ?? newId(),
          title: t,
          location: loc,
          description: desc,
          coordinates: { lat: pin[0], lon: pin[1] },
        })
      );
      onOpenChange(false);
    } finally {
      setSaveBusy(false);
    }
  }

  const canSave = Boolean(location.trim() && pin) && !saveBusy;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-labelledby={titleId}
        className="flex w-full max-w-lg flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 sm:my-4 sm:max-h-[min(92vh,720px)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 id={titleId} className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {existingDestination ? "Destination on map" : "New trip destination"}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
        </div>

        <div className="min-w-0 space-y-3 overflow-visible px-4 py-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Search for an address (Google + OpenStreetMap), or set the pin on the map. Title and
            description can be edited.
          </p>

          <div className="relative z-0 h-[220px] w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
            <MapContainer
              key={mapKey}
              center={mapCenter}
              zoom={mapZoom}
              className="h-full w-full"
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapClickSetPin position={pin} onPick={(lat, lng) => setPin([lat, lng])} />
            </MapContainer>
          </div>

          {geocodeBusy ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Looking up address…</p>
          ) : null}

          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Title
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Hotel or place name"
            />
          </label>
          <div className="relative z-20">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Address
              <PlaceSearchInput
                value={location}
                onChange={setLocation}
                onPick={onAddressPick}
                placeholder="Search street address (autocomplete)"
                listboxClassName="z-[90] shadow-xl"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Description
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Area, notes"
            />
          </label>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button
            type="button"
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-700"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleSave()}
          >
            {saveBusy ? "Saving…" : "Save destination"}
          </button>
        </div>
      </div>
    </div>
  );
}
