import { NextResponse } from "next/server";
import { getJSON, hgetJSON, hsetJSON, keys, normCode } from "@/lib/store";
import { PITCH_LIMIT, NAME_LIMIT } from "@/lib/config";

// Upsert this phone's member record: name, pitch, typing ping, thumbs up.
export async function POST(req, { params }) {
  const code = normCode((await params).code);
  const body = await req.json().catch(() => ({}));
  const { memberId } = body;
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

  const group = await getJSON(keys.group(code));
  if (!group) return NextResponse.json({ error: "No group with that code" }, { status: 404 });

  const prev = (await hgetJSON(keys.members(code), memberId)) || { id: memberId, name: "", pitch: "", thumb: false, joinedAt: Date.now(), typingAt: 0 };
  const next = { ...prev };

  if (group.status === "waiting") {
    if (typeof body.name === "string") next.name = body.name.slice(0, NAME_LIMIT);
    // Pitches over the limit are never saved: "don't be picky".
    if (typeof body.pitch === "string" && body.pitch.length <= PITCH_LIMIT) next.pitch = body.pitch;
    if (body.typing) next.typingAt = Date.now();
    if (body.typing === false) next.typingAt = 0;
  }
  if (group.status === "done" && typeof body.thumb === "boolean") next.thumb = body.thumb;

  await hsetJSON(keys.members(code), memberId, next);
  return NextResponse.json({ member: next });
}
