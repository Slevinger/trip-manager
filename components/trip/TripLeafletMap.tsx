"use client";

import { useEffect, useRef, useState } from "react";
import type { Trip } from "@/lib/types/trip";
import { coordsForLocation } from "@/lib/locationCoords";
import { useI18n } from "@/components/providers/I18nProvider";
import "leaflet/dist/leaflet.css";

export function TripLeafletMap({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layersRef = useRef<{
    markers: import("leaflet").Layer[];
    line: import("leaflet").Polyline | null;
  }>({ markers: [], line: null });
  const [mapWarnings, setMapWarnings] = useState<string[]>([]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const layers = layersRef.current;

    const ordered = [...trip.steps].sort((a, b) => a.order - b.order);
    const missing: string[] = [];
    for (const s of ordered) {
      const ll = coordsForLocation(s.location);
      if (!ll && s.location.trim()) {
        missing.push(s.title.trim() || s.location);
      }
    }
    setMapWarnings(missing);

    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !hostRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      layers.markers.forEach((m) => {
        try {
          m.remove();
        } catch {
          /* ignore */
        }
      });
      layers.markers = [];
      if (layers.line) {
        try {
          layers.line.remove();
        } catch {
          /* ignore */
        }
        layers.line = null;
      }

      const map = L.map(hostRef.current).setView([8.8, 99.3], 7);
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
          attribution: "© OpenStreetMap © CARTO",
        }
      ).addTo(map);

      const drawPts: [number, number][] = [];
      for (const s of ordered) {
        const ll = coordsForLocation(s.location);
        if (!ll) continue;
        drawPts.push(ll);
        const marker = L.circleMarker(ll, {
          radius: 8,
          color: "#2563eb",
          weight: 2,
          fillColor: "#93c5fd",
          fillOpacity: 0.9,
        })
          .addTo(map)
          .bindPopup(
            `<b>${escapeHtml(s.title)}</b><br>${escapeHtml(s.location)}`
          );
        layers.markers.push(marker);
      }

      if (drawPts.length > 1) {
        const line = L.polyline(drawPts, { color: "#2563eb", weight: 4 }).addTo(
          map
        );
        layers.line = line;
        map.fitBounds(line.getBounds(), { padding: [28, 28] });
      } else if (drawPts.length === 1) {
        map.setView(drawPts[0], 8);
      }

      window.setTimeout(() => {
        map.invalidateSize();
      }, 120);
    })();

    return () => {
      cancelled = true;
      layers.markers.forEach((m) => {
        try {
          m.remove();
        } catch {
          /* ignore */
        }
      });
      layers.markers = [];
      if (layers.line) {
        try {
          layers.line.remove();
        } catch {
          /* ignore */
        }
        layers.line = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [trip]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("view.mapTitle")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500">{t("view.mapAttribution")}</p>
      <div className="mt-3 h-[min(420px,55vh)] w-full overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div ref={hostRef} className="h-full w-full" />
      </div>
      {mapWarnings.length > 0 ? (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
          {t("view.mapNotListed")}: {mapWarnings.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
