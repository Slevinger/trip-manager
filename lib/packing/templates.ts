import type { PackingCategory, PackingItem } from "@/lib/types/trip";
import type { MessageKey } from "@/lib/i18n/messages";

export interface PackingTemplate {
  id: string;
  /** i18n key for the human-readable template name. */
  labelKey: MessageKey;
  emoji: string;
  items: { name: string; category: PackingCategory; quantity?: number }[];
}

export const PACKING_TEMPLATES: PackingTemplate[] = [
  {
    id: "tpl-beach-weekend",
    labelKey: "packing.template.beach",
    emoji: "🏖",
    items: [
      { name: "Passport", category: "documents" },
      { name: "Travel insurance card", category: "documents" },
      { name: "Sunglasses", category: "clothes" },
      { name: "Swimsuit", category: "clothes", quantity: 2 },
      { name: "Linen shirts", category: "clothes", quantity: 3 },
      { name: "Flip flops", category: "clothes" },
      { name: "Reef-safe sunscreen", category: "toiletries" },
      { name: "After-sun lotion", category: "toiletries" },
      { name: "Reusable water bottle", category: "gear" },
      { name: "Snorkel mask", category: "gear" },
      { name: "Universal adapter", category: "tech" },
      { name: "Mosquito repellent", category: "health" },
    ],
  },
  {
    id: "tpl-city-break",
    labelKey: "packing.template.city",
    emoji: "🏙",
    items: [
      { name: "Passport", category: "documents" },
      { name: "Local transit card", category: "documents" },
      { name: "Comfortable walking shoes", category: "clothes" },
      { name: "Light jacket", category: "clothes" },
      { name: "Compact umbrella", category: "gear" },
      { name: "Day backpack", category: "gear" },
      { name: "Power bank", category: "tech" },
      { name: "Universal adapter", category: "tech" },
      { name: "Toothbrush + toothpaste", category: "toiletries" },
      { name: "Hand sanitizer", category: "health" },
    ],
  },
  {
    id: "tpl-hike",
    labelKey: "packing.template.hike",
    emoji: "🥾",
    items: [
      { name: "Hiking boots", category: "clothes" },
      { name: "Quick-dry t-shirts", category: "clothes", quantity: 3 },
      { name: "Rain shell", category: "clothes" },
      { name: "Wool socks", category: "clothes", quantity: 3 },
      { name: "Backpack 30L", category: "gear" },
      { name: "Headlamp", category: "gear" },
      { name: "Water filter", category: "gear" },
      { name: "First-aid kit", category: "health" },
      { name: "Blister care", category: "health" },
      { name: "Sunscreen SPF 50", category: "toiletries" },
      { name: "Map / GPS", category: "tech" },
    ],
  },
  {
    id: "tpl-long-haul",
    labelKey: "packing.template.longHaul",
    emoji: "✈️",
    items: [
      { name: "Passport", category: "documents" },
      { name: "Boarding pass / e-ticket", category: "documents" },
      { name: "Compression socks", category: "clothes" },
      { name: "Eye mask", category: "gear" },
      { name: "Neck pillow", category: "gear" },
      { name: "Noise-cancelling headphones", category: "tech" },
      { name: "Power bank (TSA-safe)", category: "tech" },
      { name: "Universal adapter", category: "tech" },
      { name: "Refillable water bottle", category: "gear" },
      { name: "Lip balm", category: "toiletries" },
      { name: "Melatonin", category: "health" },
    ],
  },
];

export function templateById(id: string): PackingTemplate | null {
  return PACKING_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function newPackingItemId(existing: PackingItem[]): string {
  let n = existing.length + 1;
  while (existing.some((i) => i.id === `pi-${n}`)) n += 1;
  return `pi-${n}`;
}

/**
 * Append items from a template to an existing list (idempotent on `name +
 * category` to avoid duplicates when re-applying a template).
 */
export function applyTemplate(items: PackingItem[], template: PackingTemplate): PackingItem[] {
  const seen = new Set(items.map((i) => `${i.category}:${i.name.trim().toLowerCase()}`));
  const next = [...items];
  for (const tpl of template.items) {
    const k = `${tpl.category}:${tpl.name.trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    next.push({
      id: newPackingItemId(next),
      name: tpl.name,
      category: tpl.category,
      quantity: tpl.quantity,
      packed: false,
      templateId: template.id,
    });
    seen.add(k);
  }
  return next;
}
