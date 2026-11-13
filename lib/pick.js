// Claude picks the one restaurant that works for everyone.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

function nowInLA() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function extractJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

function heuristic(members, places, note) {
  const w = places[0];
  return {
    winnerId: w.id,
    headline: `Closest spot to everyone: ${w.walkMin} min walk.`,
    perPerson: members.map((m) => ({ memberId: m.id, name: m.name, reason: "Close by and open (demo mode)" })),
    backups: places.slice(1, 3).map((p) => ({ id: p.id, note: `${p.walkMin} min walk` })),
    ruledOut: [],
    mock: true,
    note,
  };
}

export async function pickRestaurant(members, places) {
  if (!places.length) throw new Error("No restaurants found nearby");
  if (!process.env.ANTHROPIC_API_KEY) return heuristic(members, places, "No ANTHROPIC_API_KEY set, so this is demo mode.");

  const people = members
    .map((m) => `- ${m.name || "Someone"} (id ${m.id}): "${m.pitch?.trim() || "no preference"}"`)
    .join("\n");
  const list = places
    .map((p) =>
      [p.id, p.name, p.kind, p.cuisine || "cuisine unknown", `${p.walkMin} min walk`, p.hours ? `hours: ${p.hours}` : "hours unknown", p.veg, p.seats]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n");

  const system = `You are the tie-breaker for a group of hungry college friends deciding where to eat RIGHT NOW.
Pick exactly ONE restaurant from the list that best satisfies EVERYONE's pitch. Hard constraints (dietary needs, "no X", walking limits, budget, must be open now) beat soft preferences.
Use the listed data first. You may use general knowledge of well-known places/chains (e.g. typical price, vibe), but say "likely" when you are not sure. Never invent places or ids.
Reply with ONLY a JSON object, no prose, in this exact shape:
{"winnerId":"<id from list>","headline":"<one punchy line, max 14 words, why this works for the whole group>","perPerson":[{"memberId":"<id>","name":"<name>","reason":"<max 12 words, why it works for THIS person's pitch>"}],"backups":[{"id":"<id>","note":"<max 8 words>"}],"ruledOut":[{"id":"<id>","reason":"<max 8 words, which person's pitch it breaks>"}]}
Give exactly 2 backups and 3-5 ruledOut entries (choose notable nearby places that clearly break someone's pitch).`;

  const user = `Current time: ${nowInLA()} (Berkeley, CA).

The group's pitches:
${people}

Restaurants nearby (id | name | type | cuisine | walk | hours | tags):
${list}`;

  const client = new Anthropic({ timeout: 45000 });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = extractJSON(text);

  const ids = new Set(places.map((p) => p.id));
  if (!ids.has(out.winnerId)) return heuristic(members, places, "Claude returned an unknown place, so we fell back to the closest.");
  out.backups = (out.backups || []).filter((b) => ids.has(b.id) && b.id !== out.winnerId).slice(0, 3);
  out.ruledOut = (out.ruledOut || []).filter((b) => ids.has(b.id) && b.id !== out.winnerId).slice(0, 6);
  out.perPerson = (out.perPerson || []).slice(0, 12);
  return out;
}
