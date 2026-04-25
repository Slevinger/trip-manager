const KNOWN_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  Phuket: { lat: 7.8804, lng: 98.3923 },
  "Khao Sok": { lat: 8.9089, lng: 98.5303 },
  "Ko Yao Noi": { lat: 8.1225, lng: 98.595 },
  "Koh Samui": { lat: 9.512, lng: 100.0136 },
  "Koh Phangan": { lat: 9.7319, lng: 100.0136 },
  "Koh Tao": { lat: 10.0967, lng: 99.8406 },
  Bangkok: { lat: 13.7563, lng: 100.5018 },
  "Chiang Mai": { lat: 18.7883, lng: 98.9853 },
  Krabi: { lat: 8.0863, lng: 98.9063 },
  "Ao Nang": { lat: 8.0375, lng: 98.8183 },
  Railay: { lat: 8.0067, lng: 98.8375 },
  "Phi Phi": { lat: 7.7407, lng: 98.7784 },
  "Surat Thani": { lat: 9.1397, lng: 99.3331 },
};

const ALIASES: Record<string, keyof typeof KNOWN_LOCATIONS> = {
  phuket: "Phuket",
  "\u05e4\u05d5\u05e7\u05d8": "Phuket",
  "\u043f\u0445\u0443\u043a\u0435\u0442": "Phuket",
  "phuket, thailand": "Phuket",
  "khao sok": "Khao Sok",
  "khao sok national park": "Khao Sok",
  "khao sok national park, thailand": "Khao Sok",
  "ko yao noi": "Ko Yao Noi",
  "koh yao noi": "Ko Yao Noi",
  "ko yao noi, thailand": "Ko Yao Noi",
  "koh samui": "Koh Samui",
  "koh samui, thailand": "Koh Samui",
  "ko samui": "Koh Samui",
  "koh phangan": "Koh Phangan",
  "ko phangan": "Koh Phangan",
  "koh pha ngan": "Koh Phangan",
  "koh tao": "Koh Tao",
  "ko tao": "Koh Tao",
  bangkok: "Bangkok",
  "\u0431\u0430\u043d\u0433\u043a\u043e\u043a": "Bangkok",
  "\u05d1\u05e0\u05e7\u05d5\u05e7": "Bangkok",
  "chiang mai": "Chiang Mai",
  "\u0447\u0438\u0430\u043d\u0433\u043c\u0430\u0439": "Chiang Mai",
  krabi: "Krabi",
  "ao nang": "Ao Nang",
  railay: "Railay",
  "phi phi": "Phi Phi",
  "koh phi phi": "Phi Phi",
  "ko phi phi": "Phi Phi",
  "surat thani": "Surat Thani",
  "\u0441\u0443\u0440\u0430\u0442 \u0442\u0445\u0430\u043d\u0438": "Surat Thani",
};

const locationCache = new Map<string, { lat: number; lng: number } | null>();

function normalizeLocation(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ");
}

function canonicalLocationName(input: string): keyof typeof KNOWN_LOCATIONS | null {
  const normalized = normalizeLocation(input);
  if (!normalized) return null;
  if (normalized in ALIASES) return ALIASES[normalized];
  for (const key of Object.keys(KNOWN_LOCATIONS) as Array<keyof typeof KNOWN_LOCATIONS>) {
    if (normalizeLocation(key) === normalized) return key;
  }
  return null;
}

export function resolveLocationCoordinates(location: string): { lat: number; lng: number } | null {
  const cacheKey = normalizeLocation(location);
  if (!cacheKey) return null;
  if (locationCache.has(cacheKey)) {
    return locationCache.get(cacheKey) ?? null;
  }
  const canonical = canonicalLocationName(location);
  const resolved = canonical ? KNOWN_LOCATIONS[canonical] : null;
  locationCache.set(cacheKey, resolved);
  return resolved;
}
