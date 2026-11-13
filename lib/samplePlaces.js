// Made-up places used ONLY when PICKY_FAKE_PLACES=1 (local testing without internet).
export function samplePlaces(center) {
  const raw = [
    ["Sun Bowl Thai", "thai", 0.0021, 0.0019, "vegetarian options", "Mo-Su 11:00-22:00"],
    ["Taqueria Luna", "mexican", -0.0012, -0.0016, "vegetarian options", "Mo-Su 10:00-23:00"],
    ["Slice House", "pizza", -0.0026, -0.0021, "", "Mo-Su 11:00-02:00"],
    ["Kin Ramen", "ramen", 0.0031, 0.0009, "", "Mo-Su 17:00-22:00"],
    ["Green Fork", "vegan", 0.0036, 0.0034, "vegan options", "Mo-Su 11:00-21:30"],
    ["Café Rue", "coffee shop", -0.0028, 0.0024, "", "Mo-Su 07:00-20:30"],
    ["Burger Barn", "burger", 0.0009, -0.0031, "", "Mo-Su 11:00-23:00"],
    ["Pho Real", "vietnamese", -0.0039, 0.0006, "vegetarian options", "Mo-Su 10:30-21:00"],
  ];
  const R = 6371000;
  return raw.map(([name, cuisine, dLat, dLng, veg, hours], i) => {
    const lat = center.lat + dLat;
    const lng = center.lng + dLng;
    const x = (dLng * Math.PI) / 180 * Math.cos((center.lat * Math.PI) / 180) * R;
    const y = (dLat * Math.PI) / 180 * R;
    const d = Math.round(Math.hypot(x, y));
    return { id: `s${i}`, name, lat, lng, kind: "restaurant", cuisine, veg, hours, seats: "", takeaway: "", distM: d, walkMin: Math.max(1, Math.round(d / 80)) };
  }).sort((a, b) => a.distM - b.distM);
}
