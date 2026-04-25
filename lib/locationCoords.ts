/** Known locations from the original HTML prototype (lat, lng). */
const COORDS: Record<string, [number, number]> = {
  "Phuket, Thailand": [7.8804, 98.3923],
  "Khao Sok National Park, Thailand": [8.9089, 98.5303],
  "Ko Yao Noi, Thailand": [8.1225, 98.595],
  "Koh Samui, Thailand": [9.512, 100.0136],
  "Koh Phangan, Thailand": [9.7319, 100.0136],
  "Koh Tao, Thailand": [10.0967, 99.8406],
};

export function coordsForLocation(location: string): [number, number] | null {
  const key = location.trim();
  if (!key) return null;
  const direct = COORDS[key];
  if (direct) return direct;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(COORDS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}
