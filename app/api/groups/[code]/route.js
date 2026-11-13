import { NextResponse } from "next/server";
import { getJSON, hgetallJSON, keys, normCode } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const code = normCode((await params).code);
  const group = await getJSON(keys.group(code));
  if (!group) return NextResponse.json({ error: "No group with that code" }, { status: 404 });
  const members = Object.values(await hgetallJSON(keys.members(code))).sort((a, b) => a.joinedAt - b.joinedAt);
  return NextResponse.json({ group, members, serverNow: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
