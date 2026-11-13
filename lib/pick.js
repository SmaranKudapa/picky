// The AI picks the one restaurant that works for everyone.
// Provider: OpenAI when OPENAI_API_KEY is set, otherwise Claude when ANTHROPIC_API_KEY is set,
// otherwise demo mode (closest place). The model gets every pitch (with names), the current Berkeley
// time and the place list, replies with strict JSON, and the server checks every id. If the reply is
// bad in any way, we fall back to the closest place so Find always finishes.
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const AI_TIMEOUT_MS = 35000; // keeps Find inside Vercel's 60 s limit (places get ~15 s)

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

// ---------- OpenAI ----------
async function askOpenAI(system, user) {
  const client = new OpenAI({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  const base = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  let res;
  try {
    res = await client.chat.completions.create({
      ...base,
      reasoning_effort: "low",
      max_completion_tokens: 8000,
      response_format: { type: "json_schema", json_schema: { name: "pick", strict: true, schema: PICK_SCHEMA } },
    });
  } catch (e) {
    // Some models reject reasoning_effort or structured outputs: retry with a plain request.
    if (!(e instanceof OpenAI.BadRequestError)) throw e;
    console.warn("pick: OpenAI retrying plain", e.message);
    res = await client.chat.completions.create(base);
  }
  const choice = res.choices?.[0];
  if (choice?.message?.refusal) return { refused: true };
  return { text: choice?.message?.content || "" };
}

// ---------- Claude ----------
async function askClaude(system, user) {
  const client = new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  const params = {
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system,
    messages: [{ role: "user", content: user }],
  };
  let msg;
  try {
    // Structured output + server-side refusal fallback to another model.
    msg = await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { ...params.output_config, format: { type: "json_schema", schema: PICK_SCHEMA } },
    });
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.warn("pick: Claude retrying plain", e.message);
    msg = await client.messages.create(params);
  }
  if (msg.stop_reason === "refusal") return { refused: true };
  return { text: msg.content.filter((b) => b.type === "text").map((b) => b.text).join("") };
}

export async function pickRestaurant(members, places) {
  if (!places.length) throw new Error("No restaurants found nearby");
  const provider = process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "claude" : null;
  if (!provider) return heuristic(members, places, "No OPENAI_API_KEY set, so this is demo mode.");

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

  try {
    const reply = provider === "openai" ? await askOpenAI(system, user) : await askClaude(system, user);
    if (reply.refused) return heuristic(members, places, "The AI declined this one, so we picked the closest.");
    const out = extractJSON(reply.text);
    if (!places.some((p) => p.id === out.winnerId)) return heuristic(members, places, "The AI returned an unknown place, so we fell back to the closest.");
    return { ...normalize(out, members, places), provider };
  } catch (e) {
    console.error(`pick: ${provider} failed`, e);
    return heuristic(members, places, "Couldn't reach the AI, so we picked the closest.");
  }
}
