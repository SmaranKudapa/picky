// Real nearby restaurants from OpenStreetMap (Overpass API). Free, no API key.
import { getJSON, setJSON, keys } from "./store";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function fetchOverpass(query) {
  let lastErr;
  for (const url of MIRRORS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "picky-hackathon-app" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Overpass failed");
}

export async function getNearbyPlaces(center, radius = 1200) {
  if (process.env.PICKY_FAKE_PLACES === "1") return (await import("./samplePlaces")).samplePlaces(center);
  const cacheKey = keys.placesCache(center.lat, center.lng);
  const query = `[out:json][timeout:20];
(
  node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:${radius},${center.lat},${center.lng});
  way["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:${radius},${center.lat},${center.lng});
);
out center tags 150;`;

  let data;
  try {
    data = await fetchOverpass(query);
  } catch (e) {
    const cached = await getJSON(cacheKey);
    if (cached?.length) return cached; // last good result for this spot
    throw e;
  }

  const seen = new Set();
  const places = (data.elements || [])
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const t = el.tags || {};
      if (lat == null || !t.name) return null;
      const d = distM(center, { lat, lng });
      return {
        id: `${el.type[0]}${el.id}`,
        name: t.name,
        lat,
        lng,
        kind: t.amenity,
        cuisine: (t.cuisine || "").replace(/;/g, ", ").replace(/_/g, " "),
        veg: t["diet:vegan"] === "yes" ? "vegan options" : t["diet:vegetarian"] === "yes" || t["diet:vegetarian"] === "only" ? "vegetarian options" : "",
        hours: t.opening_hours || "",
        seats: t.outdoor_seating === "yes" ? "outdoor seating" : "",
        takeaway: t.takeaway || "",
        distM: Math.round(d),
        walkMin: Math.max(1, Math.round(d / 80)),
      };
    })
    .filter((p) => p && !seen.has(p.name + p.lat.toFixed(4)) && seen.add(p.name + p.lat.toFixed(4)))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, 60);

  if (places.length) await setJSON(cacheKey, places);
  return places;
}
