import { NextResponse } from "next/server";
import { getJSON, setJSON, keys, usingRedis } from "@/lib/store";

const WORDS = ["TACO", "BOBA", "RAMEN", "CURRY", "BAGEL", "SUSHI", "MOCHI", "PHO", "WAFFLE", "NACHO", "DUMPLING", "CREPE", "FALAFEL", "BURRITO"];

export async function POST(req) {
  const { memberId, dev } = await req.json().catch(() => ({}));
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
  if (process.env.VERCEL && !usingRedis)
    return NextResponse.json({ error: "Setup needed: connect Upstash Redis in Vercel → Storage, then redeploy." }, { status: 500 });

  if (dev) {
    // Dev mode test group: code like DEV-4821 so friends can join to test multi-phone.
    for (let i = 0; i < 20; i++) {
      const num = String(Math.floor(1000 + Math.random() * 9000));
      const code = "DEV" + num;
      if (await getJSON(keys.group(code))) continue;
      const group = { code, display: `DEV-${num}`, leaderId: memberId, status: "waiting", createdAt: Date.now(), result: null, error: null, dev: true };
      await setJSON(keys.group(code), group);
      return NextResponse.json({ group });
    }
    return NextResponse.json({ error: "Could not create dev group" }, { status: 500 });
  }

  for (let i = 0; i < 20; i++) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const num = String(Math.floor(10 + Math.random() * 90));
    const code = word + num;
    if (await getJSON(keys.group(code))) continue;
    const group = { code, display: `${word}-${num}`, leaderId: memberId, status: "waiting", createdAt: Date.now(), result: null, error: null };
    await setJSON(keys.group(code), group);
    return NextResponse.json({ group });
  }
  return NextResponse.json({ error: "Could not create group" }, { status: 500 });
}
