// Real nearby restaurants from OpenStreetMap (Overpass API). Free, no API key.
import { getJSON, setJSON, keys, PLACES_TTL } from "./store";

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

// Total time budget for all mirrors, so Find stays inside Vercel's 60 s limit (Claude gets ~35 s).
const OVERPASS_BUDGET_MS = 15000;
const NEARBY_CACHE_M = 1500; // reuse the last good list if the leader is within this distance of it

async function fetchOverpass(query) {
  let lastErr;
  const deadline = Date.now() + OVERPASS_BUDGET_MS;
  for (const url of MIRRORS) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), Math.min(9000, left));
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
    // Otherwise use the last good list if it was fetched near here (e.g. the practice Find).
    const last = await getJSON(keys.placesLast);
    if (last?.places?.length && distM(center, last.center) <= NEARBY_CACHE_M) return remeasure(last.places, center);
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

  if (places.length) {
    await setJSON(cacheKey, places, PLACES_TTL);
    await setJSON(keys.placesLast, { center, places }, PLACES_TTL);
  }
  return places;
}

// Recompute distance and walk time from a new center (for a cached list).
function remeasure(places, center) {
  return places
    .map((p) => {
      const d = distM(center, p);
      return { ...p, distM: Math.round(d), walkMin: Math.max(1, Math.round(d / 80)) };
    })
    .filter((p) => p.distM <= 2000)
    .sort((a, b) => a.distM - b.distM)
    .slice(0, 60);
}
