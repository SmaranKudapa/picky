// Real nearby restaurants. Every source returns OpenStreetMap places in the same shape.
// 1) Geoapify Places API (hosted, reliable; needs GEOAPIFY_API_KEY, free 3,000 requests/day).
//    One request returns every restaurant, fast-food place and cafe in the radius, with cuisine, hours and veg tags.
// 2) Overpass (free community servers, no key). All mirrors are asked at once; first answer wins.
// 3) The last good list for this spot (cache), so a practice Find keeps the demo working.
// 4) Nominatim (OpenStreetMap's own search, no key): a few category searches in a box around the leader.
// 5) Photon (komoot's OSM search, no key): many name searches in parallel.
import { getJSON, setJSON, keys, PLACES_TTL } from "./store";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const UA = { "User-Agent": "picky/1.0 (group food picker; https://github.com/SmaranKudapa/picky)" };

function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Time budgets, so Find stays inside Vercel's 60 s limit (the AI gets ~35 s).
const GEOAPIFY_MS = 7000;
const OVERPASS_BUDGET_MS = 10000;
const NEARBY_CACHE_M = 1500; // reuse the last good list if the leader is within this distance of it

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${new URL(url).host} timed out`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const bboxAround = (center, radius) => {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
  return { west: center.lng - dLng, south: center.lat - dLat, east: center.lng + dLng, north: center.lat + dLat };
};

// ---------- 1) Geoapify ----------
const yes = (v) => v === true || v === "yes" || v === "only";
async function fetchGeoapify(center, radius) {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error("no GEOAPIFY_API_KEY");
  const url =
    `https://api.geoapify.com/v2/places?categories=catering.restaurant,catering.fast_food,catering.cafe` +
    `&filter=circle:${center.lng},${center.lat},${radius}&bias=proximity:${center.lng},${center.lat}&limit=120&apiKey=${encodeURIComponent(key)}`;
  const data = await fetchWithTimeout(url, {}, GEOAPIFY_MS);
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    const raw = p.datasource?.raw || {};
    const cats = p.categories || [];
    const name = p.name || raw.name;
    const [lng, lat] = f.geometry?.coordinates || [p.lon, p.lat];
    if (!name || lat == null) continue;
    const amenity = raw.amenity || (cats.includes("catering.fast_food") ? "fast_food" : cats.includes("catering.cafe") ? "cafe" : "restaurant");
    // Cuisine: OSM tag first, else the most specific category (e.g. catering.restaurant.thai → thai).
    const sub = cats.find((c) => /^catering\.(restaurant|fast_food|cafe)\.[a-z_]+$/.test(c));
    const cuisine = raw.cuisine || p.catering?.cuisine || (sub ? sub.split(".").pop() : "");
    const veg = raw["diet:vegetarian"] || (yes(p.catering?.diet?.vegetarian) || cats.includes("vegetarian") ? "yes" : "");
    const vegan = raw["diet:vegan"] || (yes(p.catering?.diet?.vegan) || cats.includes("vegan") ? "yes" : "");
    out.push({
      type: "geoapify",
      id: raw.osm_id ? `${String(raw.osm_type || "n")[0]}${raw.osm_id}` : `g${p.place_id}`,
      lat,
      lon: lng,
      tags: {
        name,
        amenity,
        cuisine: String(cuisine),
        "diet:vegetarian": veg,
        "diet:vegan": vegan,
        opening_hours: raw.opening_hours || p.opening_hours || "",
        outdoor_seating: raw.outdoor_seating || (p.facilities?.outdoor_seating ? "yes" : ""),
        takeaway: raw.takeaway || "",
      },
    });
  }
  if (!out.length) throw new Error("Geoapify found no places");
  return out;
}

// ---------- 2) Overpass ----------
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
    throw new Error("Overpass is down (" + (e.errors || [e]).map((x) => x.message).join("; ") + ")");
  }
}

// ---------- 4) Nominatim ----------
// Usage policy: identify the app, stay around 1 request per second. Three small searches per Find.
const NOMINATIM_QUERIES = ["restaurant", "cafe", "fast food"];
async function fetchNominatim(center, radius) {
  const b = bboxAround(center, radius);
  const viewbox = [b.west, b.north, b.east, b.south].map((n) => n.toFixed(5)).join(",");
  const out = new Map();
  for (const [i, q] of NOMINATIM_QUERIES.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    try {
      const rows = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&viewbox=${viewbox}&bounded=1&format=jsonv2&limit=50&extratags=1`,
        { headers: UA },
        5000
      );
      for (const x of rows || []) {
        if (x.category !== "amenity" || !["restaurant", "fast_food", "cafe"].includes(x.type) || !x.name) continue;
        const id = `${String(x.osm_type || "n")[0]}${x.osm_id}`;
        if (out.has(id)) continue;
        const e = x.extratags || {};
        out.set(id, { type: "nominatim", id, lat: +x.lat, lon: +x.lon, tags: { name: x.name, amenity: x.type, ...e } });
      }
    } catch {}
  }
  if (!out.size) throw new Error("Nominatim found no places");
  return [...out.values()];
}

// ---------- 5) Photon ----------
const PHOTON_QUERIES = ["restaurant", "cafe", "pizza", "burger", "thai", "sushi", "ramen", "mexican", "chinese", "indian", "korean", "boba"];
async function fetchPhoton(center, radius) {
  const b = bboxAround(center, radius);
  const bbox = [b.west, b.south, b.east, b.north].map((n) => n.toFixed(5)).join(",");
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
      const id = `${String(pr.osm_type || "n").toLowerCase()[0]}${pr.osm_id}`;
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

  const errors = [];
  let elements = null;

  // 1) Geoapify, if configured.
  if (process.env.GEOAPIFY_API_KEY) {
    try {
      elements = await fetchGeoapify(center, radius);
    } catch (e) {
      errors.push(`Geoapify: ${e.message}`);
      console.warn("places: geoapify", e.message);
    }
  }

  if (!elements) {
    // Start Photon now so it's ready if Overpass fails (Nominatim is asked only when needed: it's rate-limited).
    const photon = fetchPhoton(center, radius);
    photon.catch(() => {});

    // 2) Overpass.
    try {
      elements = (await fetchOverpass(query)).elements;
    } catch (e) {
      errors.push(e.message);
      console.warn("places:", e.message);
      // 3) The last good list for this spot, or one fetched nearby (e.g. the practice Find).
      const cached = await getJSON(cacheKey);
      if (cached?.length) return remeasure(cached, center);
      const last = await getJSON(keys.placesLast);
      if (last?.places?.length && distM(center, last.center) <= NEARBY_CACHE_M) return remeasure(last.places, center);
      // 4) Nominatim, then 5) Photon.
      for (const [label, backup] of [["Nominatim", () => fetchNominatim(center, radius)], ["Photon", () => photon]]) {
        try {
          elements = await backup();
          break;
        } catch (e2) {
          errors.push(`${label}: ${e2.message}`);
        }
      }
      if (!elements) throw new Error(`No map data right now. ${errors.join(". ")}`);
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
        id: ["photon", "geoapify", "nominatim"].includes(el.type) ? el.id : `${el.type[0]}${el.id}`,
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

  // Cache any good list (Photon has no details, so it's re-asked instead).
  if (places.length && elements?.[0]?.type !== "photon") {
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
