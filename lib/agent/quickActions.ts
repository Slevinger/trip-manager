import {
  CalendarRange,
  CloudSun,
  Coins,
  Compass,
  ListChecks,
  type LucideIcon,
  Map as MapIcon,
  MessagesSquare,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TripScreen } from "@/components/shell/navItems";

export interface AgentQuickAction {
  id: string;
  labelKey: MessageKey;
  /** Pre-fill text for the chat composer (sent with one click). */
  prompt: string;
  icon: LucideIcon;
}

const COMMON_OVERVIEW: AgentQuickAction[] = [
  {
    id: "tighten",
    labelKey: "agent.actionTighten",
    prompt: "Tighten the current day's plan — remove fluff, group nearby stops, suggest realistic time blocks.",
    icon: Wand2,
  },
  {
    id: "weather",
    labelKey: "agent.actionWeather",
    prompt: "Give me a quick weather and packing-impact summary for the trip dates.",
    icon: CloudSun,
  },
  {
    id: "budget",
    labelKey: "agent.actionBudget",
    prompt: "Estimate how much budget I have left given the current expenses, and call out the biggest line items.",
    icon: Coins,
  },
];

const ITINERARY: AgentQuickAction[] = [
  {
    id: "tighten-day",
    labelKey: "agent.actionTighten",
    prompt: "Look at the current itinerary and tighten the next 1-2 days. Trim, batch by location, and add transit timing.",
    icon: Wand2,
  },
  {
    id: "add-activity",
    labelKey: "agent.actionAddActivity",
    prompt: "Suggest 2-3 activities for the most under-scheduled day. Match the travelers' preferences and the location.",
    icon: Sparkles,
  },
  {
    id: "add-transit",
    labelKey: "agent.actionAddTransit",
    prompt: "Recommend transit options for any back-to-back stays that don't have a transit step yet.",
    icon: CalendarRange,
  },
];

const MAP_ACTIONS: AgentQuickAction[] = [
  {
    id: "nearby",
    labelKey: "agent.actionAddActivity",
    prompt: "For each destination, suggest 2 nearby activities or food spots worth adding to the trip.",
    icon: MapIcon,
  },
  {
    id: "stay",
    labelKey: "agent.actionAddStay",
    prompt: "Propose a few stay options near the trip's most central destination, with 2-3 vibes (boutique / budget / unique).",
    icon: Compass,
  },
];

const BUDGET_ACTIONS: AgentQuickAction[] = [
  {
    id: "estimate",
    labelKey: "agent.actionBudget",
    prompt: "Estimate the remaining budget based on the entered expenses and the rest of the planned trip.",
    icon: Coins,
  },
  {
    id: "cheaper-stay",
    labelKey: "agent.actionAddStay",
    prompt: "Suggest a cheaper alternative stay for the most expensive lodging in the trip without sacrificing the area.",
    icon: Sparkles,
  },
];

const PACKING_ACTIONS: AgentQuickAction[] = [
  {
    id: "packing-add",
    labelKey: "agent.actionPacking",
    prompt: "Look at the trip destinations, weather, and activities, and suggest packing additions I might be missing.",
    icon: ListChecks,
  },
  {
    id: "packing-trim",
    labelKey: "agent.actionPacking",
    prompt: "Help me trim the packing list to a carry-on without losing essentials for the planned activities.",
    icon: Wand2,
  },
];

const COLLAB_ACTIONS: AgentQuickAction[] = [
  {
    id: "consensus",
    labelKey: "agent.actionAddActivity",
    prompt: "Summarize the open comments and active recommendation votes, and propose a consensus action.",
    icon: MessagesSquare,
  },
];

const ACTIONS_BY_SCREEN: Record<TripScreen, AgentQuickAction[]> = {
  overview: COMMON_OVERVIEW,
  itinerary: ITINERARY,
  map: MAP_ACTIONS,
  budget: BUDGET_ACTIONS,
  packing: PACKING_ACTIONS,
  collab: COLLAB_ACTIONS,
  manage: COMMON_OVERVIEW,
};

export function actionsForScreen(screen: TripScreen | null): AgentQuickAction[] {
  if (!screen) return COMMON_OVERVIEW;
  return ACTIONS_BY_SCREEN[screen] ?? COMMON_OVERVIEW;
}
