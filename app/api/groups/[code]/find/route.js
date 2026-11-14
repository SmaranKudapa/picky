import { NextResponse } from "next/server";
import { getJSON, setJSON, hgetallJSON, setIfAbsent, del, keys, normCode } from "@/lib/store";
import { getNearbyPlaces } from "@/lib/places";
import { pickRestaurant } from "@/lib/pick";
import { devResult } from "@/lib/dev";
import { DEFAULT_CENTER, FIND_STALE_MS } from "@/lib/config";

export const maxDuration = 60;

export async function POST(req, { params }) {
  const code = normCode((await params).code);
  const { memberId, lat, lng } = await req.json().catch(() => ({}));
  const group = await getJSON(keys.group(code));
  if (!group) return NextResponse.json({ error: "No group with that code" }, { status: 404 });
  if (group.leaderId !== memberId) return NextResponse.json({ error: "Only the group leader can hit Find" }, { status: 403 });
  if (group.status === "done") return NextResponse.json({ group });
  if (!(await setIfAbsent(keys.lock(code), 1, Math.ceil(FIND_STALE_MS / 1000)))) return NextResponse.json({ error: "Already finding…" }, { status: 409 });

  const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : DEFAULT_CENTER;
  await setJSON(keys.group(code), { ...group, status: "finding", findingAt: Date.now(), error: null });

  try {
    // Pitches are locked from here on (the member route ignores edits unless status is "waiting").
    const members = Object.values(await hgetallJSON(keys.members(code)))
      .filter((m) => m.name || m.pitch)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (!members.length) throw new Error("Nobody has pitched yet");
    let result;
    if (group.dev) {
      // Dev mode: no places API, no AI. Short pause so the finding screen still shows.
      await new Promise((r) => setTimeout(r, 1800));
      result = { center: DEFAULT_CENTER, ...devResult(members, DEFAULT_CENTER) };
    } else {
      const places = await getNearbyPlaces(center);
      const pick = await pickRestaurant(members, places);
      result = { center, places, ...pick };
    }
    const done = { ...group, status: "done", findingAt: null, error: null, result: { ...result, foundAt: Date.now() } };
    await setJSON(keys.group(code), done);
    return NextResponse.json({ group: done });
  } catch (e) {
    console.error("find failed", e);
    const back = { ...group, status: "waiting", findingAt: null, error: `Couldn't find food: ${e.message || e}. Try again.` };
    await setJSON(keys.group(code), back);
    return NextResponse.json({ group: back }, { status: 500 });
  } finally {
    await del(keys.lock(code));
  }
}
