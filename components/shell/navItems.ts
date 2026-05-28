import {
  CalendarRange,
  CheckSquare,
  ListChecks,
  LucideIcon,
  Map as MapIcon,
  MessagesSquare,
  Settings2,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

export interface TripNavItem {
  href: (tripId: string) => string;
  /** Used for active-state matching (e.g. /itinerary). */
  match: (pathname: string, tripId: string) => boolean;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Restrict to only certain agent quick-action sets. */
  screen: "overview" | "itinerary" | "map" | "budget" | "packing" | "todos" | "collab" | "manage";
}

const subPath = (tripId: string, segment: string) => `/trip/${tripId}/${segment}`;

export const TRIP_NAV: TripNavItem[] = [
  {
    href: (id) => `/trip/${id}`,
    match: (p, id) => p === `/trip/${id}` || p === `/trip/${id}/`,
    labelKey: "dashboard.openTrip",
    icon: Sparkles,
    screen: "overview",
  },
  {
    href: (id) => subPath(id, "itinerary"),
    match: (p, id) => p.startsWith(subPath(id, "itinerary")),
    labelKey: "shell.itinerary",
    icon: CalendarRange,
    screen: "itinerary",
  },
  {
    href: (id) => subPath(id, "map"),
    match: (p, id) => p.startsWith(subPath(id, "map")),
    labelKey: "shell.map",
    icon: MapIcon,
    screen: "map",
  },
  {
    href: (id) => subPath(id, "budget"),
    match: (p, id) => p.startsWith(subPath(id, "budget")),
    labelKey: "shell.budget",
    icon: Wallet,
    screen: "budget",
  },
  {
    href: (id) => subPath(id, "packing"),
    match: (p, id) => p.startsWith(subPath(id, "packing")),
    labelKey: "shell.packing",
    icon: ListChecks,
    screen: "packing",
  },
  {
    href: (id) => subPath(id, "todos"),
    match: (p, id) => p.startsWith(subPath(id, "todos")),
    labelKey: "shell.todos",
    icon: CheckSquare,
    screen: "todos",
  },
  {
    href: (id) => subPath(id, "collab"),
    match: (p, id) => p.startsWith(subPath(id, "collab")),
    labelKey: "shell.collab",
    icon: MessagesSquare,
    screen: "collab",
  },
  {
    href: (id) => subPath(id, "manage"),
    match: (p, id) => p.startsWith(subPath(id, "manage")),
    labelKey: "shell.manage",
    icon: Settings2,
    screen: "manage",
  },
];

export type TripScreen = TripNavItem["screen"];

export function activeTripScreen(pathname: string, tripId: string | null): TripScreen | null {
  if (!tripId) return null;
  const match = TRIP_NAV.find((item) => item.match(pathname, tripId));
  return match?.screen ?? null;
}
