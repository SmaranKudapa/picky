import { NextResponse } from "next/server";
import { getJSON, setJSON, hgetallJSON, del, keys, normCode } from "@/lib/store";
import { FIND_STALE_MS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const code = normCode((await params).code);
  let group = await getJSON(keys.group(code));
  if (!group) return NextResponse.json({ error: "No group with that code" }, { status: 404 });
  // Recover a Find that never finished, so phones don't sit on "finding…" forever.
  if (group.status === "finding" && Date.now() - (group.findingAt || 0) > FIND_STALE_MS) {
    group = { ...group, status: "waiting", findingAt: null, error: "Finding took too long. Hit Find again." };
    await setJSON(keys.group(code), group);
    await del(keys.lock(code));
  }
  const members = Object.values(await hgetallJSON(keys.members(code))).sort((a, b) => a.joinedAt - b.joinedAt);
  return NextResponse.json({ group, members, serverNow: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
