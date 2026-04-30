"use client";

import { useEffect, useRef, useState } from "react";
import type { Trip } from "@/lib/types/trip";
import { coordsForLocation } from "@/lib/locationCoords";
import { useI18n } from "@/components/providers/I18nProvider";
import {
  computeNightsForStep,
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { formatStepDateRange } from "@/lib/map/mapUtils";
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
  const invalidateTimerRef = useRef<number | null>(null);

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

      const map = L.map(hostRef.current, {
        zoomAnimation: false,
        markerZoomAnimation: false,
        fadeAnimation: false,
        scrollWheelZoom: true,
        wheelDebounceTime: 120,
        wheelPxPerZoomLevel: 180,
      }).setView([8.8, 99.3], 7);
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
        if (ll) drawPts.push(ll);
      }

      const orderIndexById = new Map(ordered.map((s, idx) => [s.id, idx]));
      const rotated = rotateByProgress(ordered);
      for (const s of [...rotated].reverse()) {
        const idx = orderIndexById.get(s.id) ?? 0;
        const ll = coordsForLocation(s.location);
        if (!ll) continue;
        const markerBadge = formatMarkerBadge(
          effectiveStepStartParts(s),
          effectiveStepEndParts(s),
          computeNightsForStep(s),
          s.location,
          s.status
        );
        const markerColor =
          s.status === "active" ? "#2563eb" : s.status === "done" ? "#16a34a" : "#6b7280";
        const markerRadius = s.status === "active" ? 10 : 8;
        const marker = L.circleMarker(ll, {
          radius: markerRadius,
          color: markerColor,
          weight: 2,
          fillColor: markerColor,
          fillOpacity: 0.9,
        }).addTo(map);

        if (markerBadge) {
          marker.bindTooltip(`<div class="trip-step-badge-bubble">${markerBadge}</div>`, {
            permanent: true,
            direction: "top",
            offset: [0, -10],
            className: "trip-step-badge-tooltip",
            opacity: 1,
            interactive: false,
          });
        }

        marker.bindPopup(
            [
              `<div class="trip-step-popup">`,
              `<div><b>${idx + 1}. ${escapeHtml(s.title.trim() || "Untitled step")}</b></div>`,
              `<div>${escapeHtml(s.location.trim() || "—")}</div>`,
              `<div>${escapeHtml(formatStepDateRange(s))}</div>`,
              `<div>Transport: ${escapeHtml(
                s.type === "transit"
                  ? "Transit step"
                  : "—"
              )}</div>`,
              `<div>Hotels: ${s.type === "stay" ? s.hotels.length : 0}</div>`,
              `</div>`,
            ].join("")
          );
        marker.on("mouseover", () => marker.openPopup());
        marker.on("mouseout", () => marker.closePopup());
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

      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      invalidateTimerRef.current = window.setTimeout(() => {
        if (!cancelled && mapRef.current === map) {
          map.invalidateSize();
        }
      }, 120);
    })();

    return () => {
      cancelled = true;
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
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
        <div ref={hostRef} dir="ltr" className="h-full w-full" />
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

function formatMarkerBadge(
  stepStart: { date: string; time: string },
  stepEnd: { date: string; time: string },
  nights: number,
  location: string,
  status: Trip["steps"][number]["status"]
): string | null {
  const start = parseDdMmYyyyUtc(stepStart.date);
  const end = parseDdMmYyyyUtc(stepEnd.date) ?? deriveEndDate(start, nights);
  if (!start || !end) return null;
  const locationLabel = compactLocationLabel(location);

  const startBadge = partsFromDate(start);
  const endBadge = partsFromDate(end);
  let dateLabel = "";
  if (startBadge.month === endBadge.month) {
    dateLabel = `${pad2(startBadge.day)}-${pad2(endBadge.day)} ${startBadge.month}`;
  } else {
    dateLabel = `${pad2(startBadge.day)} ${startBadge.month} - ${pad2(endBadge.day)} ${endBadge.month}`;
  }

  const safeDate = escapeHtml(dateLabel);
  const bubbleClass =
    status === "active"
      ? "trip-step-badge-bubble trip-step-badge-bubble-active"
      : "trip-step-badge-bubble";
  if (!locationLabel) {
    return `<span class="${bubbleClass}"><span class="trip-step-badge-date">${safeDate}</span></span>`;
  }
  const safeLocation = escapeHtml(locationLabel);
  return [
    `<span class="${bubbleClass}">`,
    `<span class="trip-step-badge-date">${safeDate}</span>`,
    `<span class="trip-step-badge-sep"> · </span>`,
    `<span class="trip-step-badge-location">${safeLocation}</span>`,
    `</span>`,
  ].join("");
}

function parseDdMmYyyyUtc(value: string): Date | null {
  const v = value.trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

function partsFromDate(d: Date): { day: number; month: string } {
  const monthNames = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  return { day: d.getUTCDate(), month: monthNames[d.getUTCMonth()] };
}

function deriveEndDate(start: Date | null, nights: number): Date | null {
  if (!start) return null;
  const duration = Number.isFinite(nights) && nights > 0 ? Math.floor(nights) : 0;
  const d = new Date(start.getTime());
  d.setUTCDate(d.getUTCDate() + duration);
  return d;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function compactLocationLabel(location: string): string {
  const trimmed = location.trim();
  if (!trimmed) return "";
  const firstSegment = trimmed.split(",")[0].trim();
  if (firstSegment.length <= 28) return firstSegment;
  return `${firstSegment.slice(0, 25).trimEnd()}...`;
}

function rotateByProgress(steps: Trip["steps"]): Trip["steps"] {
  if (!steps.length) return steps;
  const activeIndex = steps.findIndex((s) => s.status === "active");
  const pivot =
    activeIndex >= 0 ? activeIndex : steps.findIndex((s) => s.status !== "done");
  if (pivot <= 0) return steps;
  return [...steps.slice(pivot), ...steps.slice(0, pivot)];
}
