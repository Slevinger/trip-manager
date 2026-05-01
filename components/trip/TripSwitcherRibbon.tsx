"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/I18nProvider";
import { getClientAuth } from "@/lib/firebase";
import { restoreTripFirebaseSession } from "@/lib/tripAuth";

type TripRow = {
  id: string;
  title: string;
};

const SWITCHER_AUTH_ID = "__trip_switcher__";
const SWITCHER_POS_KEY = "trip_switcher_position_v1";
const DRAG_THRESHOLD_PX = 4;
const VIEWPORT_PADDING = 8;

export function TripSwitcherRibbon({
  currentTripId,
  currentTripTitle,
}: {
  currentTripId: string;
  currentTripTitle: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TripRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const suppressNextClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const currentTitle = useMemo(
    () => currentTripTitle.trim() || t("app.name"),
    [currentTripTitle, t]
  );

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onPointerDown);
    }
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(SWITCHER_POS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        setPosition({ x: parsed.x, y: parsed.y });
      }
    } catch {
      /* ignore malformed localStorage values */
    }
  }, []);

  useEffect(() => {
    if (!position || typeof window === "undefined") return;
    window.localStorage.setItem(SWITCHER_POS_KEY, JSON.stringify(position));
  }, [position]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const clampToViewport = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING);
      const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING);
      if (!position) {
        setPosition({
          x: Math.min(maxX, Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - 16)),
          y: Math.min(maxY, Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - 16)),
        });
        return;
      }
      const clampedX = Math.min(maxX, Math.max(VIEWPORT_PADDING, position.x));
      const clampedY = Math.min(maxY, Math.max(VIEWPORT_PADDING, position.y));
      if (clampedX !== position.x || clampedY !== position.y) {
        setPosition({ x: clampedX, y: clampedY });
      }
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [open, position]);

  async function loadTripsOnce() {
    if (rows.length > 0 || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const restored = await restoreTripFirebaseSession(SWITCHER_AUTH_ID);
      if (restored.status === "needs_google_sign_in") {
        setRows([]);
        setLoadError(t("trips.signInHint"));
        return;
      }
      const auth = getClientAuth();
      const user = auth?.currentUser ?? restored.user;
      if (!user) {
        setLoadError(t("trips.signInHint"));
        return;
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/trips/mine", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`list_trips_failed_${res.status}`);
      const payload = (await res.json()) as { trips?: TripRow[] };
      const loaded = Array.isArray(payload.trips) ? payload.trips : [];
      setRows(loaded);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function navigateToTrip(tripId: string) {
    setOpen(false);
    if (tripId === currentTripId) return;
    router.push(`/trip/${tripId}`);
  }

  function createNewTrip() {
    setOpen(false);
    router.push("/trip/new");
  }

  function handleDragStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const origin = position ?? { x: rect.left, y: rect.top };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDragMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!containerRef.current || typeof window === "undefined") return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      drag.dragging = true;
    }
    if (!drag.dragging) return;
    const rect = containerRef.current.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING);
    const nextX = Math.min(maxX, Math.max(VIEWPORT_PADDING, drag.originX + dx));
    const nextY = Math.min(maxY, Math.max(VIEWPORT_PADDING, drag.originY + dy));
    setPosition({ x: nextX, y: nextY });
    if (open) setOpen(false);
  }

  function handleDragEnd(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) {
      suppressNextClickRef.current = true;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`pointer-events-auto fixed z-50 ${position ? "" : "bottom-4 right-4 sm:bottom-6 sm:right-6"}`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <button
        type="button"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        style={{ touchAction: "none" }}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          const next = !open;
          setOpen(next);
          if (next) void loadTripsOnce();
        }}
        className="max-w-[70vw] rounded-full border border-zinc-200 bg-white/95 px-4 py-2 text-sm font-medium text-zinc-900 shadow-lg backdrop-blur transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:bg-zinc-900"
      >
        <span className="mr-2 inline-block align-middle">🧭</span>
        <span className="inline-block max-w-[52vw] truncate align-middle">{currentTitle}</span>
      </button>

      {open ? (
        <div className="mt-2 w-72 max-w-[80vw] rounded-2xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={createNewTrip}
            className="mb-1 w-full rounded-xl bg-zinc-900 px-3 py-2 text-left text-xs font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-zinc-900"
          >
            + {t("trips.newTrip")}
          </button>
          <div className="max-h-64 overflow-auto">
            {loading ? (
              <p className="px-2 py-2 text-xs text-zinc-500">{t("common.loading")}</p>
            ) : loadError ? (
              <p className="px-2 py-2 text-xs text-red-600 dark:text-red-400">{loadError}</p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-2 text-xs text-zinc-500">{t("trips.none")}</p>
            ) : (
              <ul className="space-y-1">
                {rows.map((row) => {
                  const isCurrent = row.id === currentTripId;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        disabled={isCurrent}
                        onClick={() => navigateToTrip(row.id)}
                        className="w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-zinc-100 disabled:cursor-default disabled:bg-violet-50 disabled:text-violet-800 dark:hover:bg-zinc-800 dark:disabled:bg-violet-950/40 dark:disabled:text-violet-200"
                      >
                        <div className="truncate font-medium">{row.title || t("app.name")}</div>
                        <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {row.id}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
