// Real nearby restaurants from OpenStreetMap. Free, no API key.
// 1) Overpass (best data: cuisine, hours, veg tags). All mirrors are asked at once; first answer wins.
// 2) If Overpass is down: the last good Overpass list for this spot (cache).
// 3) Otherwise Photon (komoot's OSM search): many name searches in parallel. Real places, fewer details.
import { getJSON, setJSON, keys, PLACES_TTL } from "./store";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const UA = { "User-Agent": "picky-hackathon-app" };

function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Time budget for Overpass, so Find stays inside Vercel's 60 s limit (the AI gets ~35 s).
const OVERPASS_BUDGET_MS = 12000;
const NEARBY_CACHE_M = 1500; // reuse the last good list if the leader is within this distance of it

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Ask every mirror at once and take the first good answer.
async function fetchOverpass(query) {
  const body = "data=" + encodeURIComponent(query);
  const headers = { "Content-Type": "application/x-www-form-urlencoded", ...UA };
  try {
    return await Promise.any(
      MIRRORS.map(async (url) => {
        const data = await fetchWithTimeout(url, { method: "POST", body, headers }, OVERPASS_BUDGET_MS);
        if (!Array.isArray(data?.elements)) throw new Error("bad Overpass reply");
        return data;
      })
    );
  } catch (e) {
    throw new Error("Map data (Overpass) is down: " + (e.errors || [e]).map((x) => x.message).join("; "));
  }
}

const PHOTON_QUERIES = ["restaurant", "cafe", "coffee", "pizza", "burger", "thai", "sushi", "ramen", "mexican", "taqueria", "chinese", "indian", "korean", "vietnamese", "pho", "mediterranean", "vegan", "sandwich", "bakery", "grill", "noodle", "boba"];

// Backup source: Photon only does name search, so run many food searches in a box around the leader.
async function fetchPhoton(center, radius) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat].map((n) => n.toFixed(5)).join(",");
  const results = await Promise.allSettled(
    PHOTON_QUERIES.map((q) =>
      fetchWithTimeout(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=${bbox}&lat=${center.lat}&lon=${center.lng}&limit=50`, { headers: UA }, 8000)
    )
  );
  const out = new Map();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const f of r.value.features || []) {
      const pr = f.properties || {};
      if (pr.osm_key !== "amenity" || !["restaurant", "fast_food", "cafe"].includes(pr.osm_value) || !pr.name) continue;
      const [lng, lat] = f.geometry?.coordinates || [];
      if (lat == null) continue;
      const id = `${String(pr.osm_type || "n").toLowerCase()}${pr.osm_id}`;
      if (!out.has(id)) out.set(id, { type: "photon", id, lat, lon: lng, tags: { name: pr.name, amenity: pr.osm_value } });
    }
  }
  if (!out.size) throw new Error("Photon found no places");
  return [...out.values()];
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

  // Start the backup right away so it's ready if Overpass fails (it only takes ~1 s).
  const photon = fetchPhoton(center, radius);
  photon.catch(() => {});

  let elements;
  let fromOverpass = true;
  try {
    elements = (await fetchOverpass(query)).elements;
  } catch (e) {
    console.warn("places:", e.message);
    const cached = await getJSON(cacheKey);
    if (cached?.length) return cached; // last good Overpass result for this spot
    // Otherwise use the last good list if it was fetched near here (e.g. the practice Find).
    const last = await getJSON(keys.placesLast);
    if (last?.places?.length && distM(center, last.center) <= NEARBY_CACHE_M) return remeasure(last.places, center);
    try {
      elements = await photon;
      fromOverpass = false;
    } catch (e2) {
      throw new Error(`${e.message}. Backup: ${e2.message}`);
    }
  }

  const seen = new Set();
  const places = (elements || [])
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const t = el.tags || {};
      if (lat == null || !t.name) return null;
      const d = distM(center, { lat, lng });
      if (d > radius * 1.25) return null;
      return {
        id: el.type === "photon" ? el.id : `${el.type[0]}${el.id}`,
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

  // Only cache Overpass lists: they have the details, and Photon is fast enough to re-ask.
  if (places.length && fromOverpass) {
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
