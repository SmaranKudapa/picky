import { NextResponse } from "next/server";
import { getJSON, setJSON, hgetallJSON, setIfAbsent, del, keys, normCode } from "@/lib/store";
import { getNearbyPlaces } from "@/lib/places";
import { pickRestaurant } from "@/lib/pick";
import { DEFAULT_CENTER } from "@/lib/config";

export const maxDuration = 60;

export async function POST(req, { params }) {
  const code = normCode((await params).code);
  const { memberId, lat, lng } = await req.json().catch(() => ({}));
  const group = await getJSON(keys.group(code));
  if (!group) return NextResponse.json({ error: "No group with that code" }, { status: 404 });
  if (group.leaderId !== memberId) return NextResponse.json({ error: "Only the group leader can hit Find" }, { status: 403 });
  if (group.status === "done") return NextResponse.json({ group });
  if (!(await setIfAbsent(keys.lock(code), 1, 70))) return NextResponse.json({ error: "Already finding…" }, { status: 409 });

  const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : DEFAULT_CENTER;
  await setJSON(keys.group(code), { ...group, status: "finding", error: null });

  try {
    const members = Object.values(await hgetallJSON(keys.members(code)))
      .filter((m) => m.name || m.pitch)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const places = await getNearbyPlaces(center);
    const pick = await pickRestaurant(members, places);
    const done = { ...group, status: "done", error: null, result: { center, places, ...pick, foundAt: Date.now() } };
    await setJSON(keys.group(code), done);
    return NextResponse.json({ group: done });
  } catch (e) {
    console.error("find failed", e);
    const back = { ...group, status: "waiting", error: `Couldn't find food: ${e.message || e}. Try again.` };
    await setJSON(keys.group(code), back);
    return NextResponse.json({ group: back }, { status: 500 });
  } finally {
    await del(keys.lock(code));
  }
}
