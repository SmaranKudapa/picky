// Dev mode: entering the secret code DEV-67 creates a test group that runs every screen
// without calling the places APIs or the AI, so testing burns no credits.
export const DEV_SECRET = "DEV67";

// Taco Bell Cantina, 2528 Durant Ave (near Durant & Telegraph), Berkeley.
export const DEV_PLACE = {
  id: "dev-tacobell",
  name: "Taco Bell Cantina",
  lat: 37.86785,
  lng: -122.25845,
  kind: "fast_food",
  cuisine: "mexican",
  veg: "vegetarian options",
  hours: "Mo-Su 08:00-02:00",
  seats: "",
  takeaway: "yes",
};

export function devResult(members, center) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(DEV_PLACE.lat - center.lat);
  const dLng = toRad(DEV_PLACE.lng - center.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(center.lat)) * Math.cos(toRad(DEV_PLACE.lat)) * Math.sin(dLng / 2) ** 2;
  const distM = Math.round(2 * R * Math.asin(Math.sqrt(s)));
  const place = { ...DEV_PLACE, distM, walkMin: Math.max(1, Math.round(distM / 80)) };
  return {
    places: [place],
    winnerId: place.id,
    headline: "default location lol",
    perPerson: members.map((m) => ({ memberId: m.id, name: m.name, reason: "default location lol" })),
    backups: [],
    ruledOut: [],
    dev: true,
  };
}
