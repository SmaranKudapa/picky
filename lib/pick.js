// Claude picks the one restaurant that works for everyone.
// MVP contract: Claude gets every pitch (with names), the current Berkeley time and the place list,
// replies with strict JSON, and the server checks every id. If there's no API key, or the reply is
// bad in any way, we fall back to the closest place so Find always finishes.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const CLAUDE_TIMEOUT_MS = 35000; // keeps Find inside Vercel's 60 s limit (places get ~15 s)

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

// JSON schema for structured outputs, so the reply is guaranteed to parse.
const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["winnerId", "headline", "perPerson", "backups", "ruledOut"],
  properties: {
    winnerId: { type: "string" },
    headline: { type: "string" },
    perPerson: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["memberId", "name", "reason"],
        properties: { memberId: { type: "string" }, name: { type: "string" }, reason: { type: "string" } },
      },
    },
    backups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "note"],
        properties: { id: { type: "string" }, note: { type: "string" } },
      },
    },
    ruledOut: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

// Demo mode / fallback: the closest place.
function heuristic(members, places, note) {
  const w = places[0];
  return {
    winnerId: w.id,
    headline: `Closest spot to everyone: ${w.walkMin} min walk.`,
    perPerson: members.map((m) => ({ memberId: m.id, name: m.name, reason: "Close by, so it's quick for you" })),
    backups: places.slice(1, 3).map((p) => ({ id: p.id, note: `${p.walkMin} min walk` })),
    ruledOut: [],
    mock: true,
    note,
  };
}

// Make Claude's reply match the MVP exactly: real ids only, 2 backups, one reason per person.
function normalize(out, members, places) {
  const ids = new Set(places.map((p) => p.id));
  const backups = (out.backups || []).filter((b, i, a) => ids.has(b.id) && b.id !== out.winnerId && a.findIndex((x) => x.id === b.id) === i);
  for (const p of places) {
    if (backups.length >= 2) break;
    if (p.id !== out.winnerId && !backups.some((b) => b.id === p.id)) backups.push({ id: p.id, note: `${p.walkMin} min walk` });
  }
  const used = new Set([out.winnerId, ...backups.map((b) => b.id)]);
  const ruledOut = (out.ruledOut || []).filter((r) => ids.has(r.id) && !used.has(r.id)).slice(0, 5);

  const given = out.perPerson || [];
  const perPerson = members.map((m) => {
    const hit = given.find((p) => p.memberId === m.id) || given.find((p) => p.name && p.name === m.name);
    return { memberId: m.id, name: m.name, reason: hit?.reason || "Works with what you pitched" };
  });

  return {
    winnerId: out.winnerId,
    headline: String(out.headline || "").trim() || "The one place that works for everyone.",
    perPerson,
    backups: backups.slice(0, 2),
    ruledOut,
  };
}

async function askClaude(client, params, { structured }) {
  // Sonnet 5.5 can decline a request; the server-side fallback re-runs it on another model.
  const req = { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  if (structured) req.output_config = { ...(req.output_config || {}), format: { type: "json_schema", schema: PICK_SCHEMA } };
  return client.beta.messages.create(req);
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
Give one perPerson entry for every person, exactly 2 backups, and 3-5 ruledOut entries (choose notable nearby places that clearly break someone's pitch).`;

  const user = `Current time: ${nowInLA()} (Berkeley, CA).

The group's pitches:
${people}

Restaurants nearby (id | name | type | cuisine | walk | hours | tags):
${list}`;

  const params = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system,
    messages: [{ role: "user", content: user }],
  };

  try {
    const client = new Anthropic({ timeout: CLAUDE_TIMEOUT_MS, maxRetries: 0 });
    let msg;
    try {
      msg = await askClaude(client, params, { structured: true });
    } catch (e) {
      // If the API rejects the optional features (structured output / fallbacks), retry plain.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.warn("pick: retrying without structured output", e.message);
      msg = await client.messages.create(params);
    }
    if (msg.stop_reason === "refusal") return heuristic(members, places, "Claude declined this one, so we picked the closest.");
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const out = extractJSON(text);
    if (!places.some((p) => p.id === out.winnerId)) return heuristic(members, places, "Claude returned an unknown place, so we fell back to the closest.");
    return normalize(out, members, places);
  } catch (e) {
    console.error("pick: Claude failed", e);
    return heuristic(members, places, "Couldn't reach Claude, so we picked the closest.");
  }
}
