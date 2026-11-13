// Shared state for groups. Uses Upstash Redis when env vars exist (needed on Vercel),
// otherwise an in-memory store (fine for local `npm run dev`).
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const TTL = 60 * 60 * 6; // groups expire after 6 hours
const mem = globalThis.__pickyMem || (globalThis.__pickyMem = { kv: new Map(), h: new Map() });

export const usingRedis = !!redis;

export async function getJSON(key) {
  if (redis) return (await redis.get(key)) ?? null;
  const v = mem.kv.get(key);
  return v ? JSON.parse(v) : null;
}

export async function setJSON(key, val) {
  if (redis) {
    await redis.set(key, val, { ex: TTL });
    return;
  }
  mem.kv.set(key, JSON.stringify(val));
}

// Returns true if the key was set (it didn't exist before).
export async function setIfAbsent(key, val, ttlSeconds = 60) {
  if (redis) return (await redis.set(key, val, { nx: true, ex: ttlSeconds })) === "OK";
  if (mem.kv.has(key)) return false;
  mem.kv.set(key, JSON.stringify(val));
  setTimeout(() => mem.kv.delete(key), ttlSeconds * 1000);
  return true;
}

export async function del(key) {
  if (redis) return redis.del(key);
  mem.kv.delete(key);
}

export async function hsetJSON(key, field, val) {
  if (redis) {
    await redis.hset(key, { [field]: val });
    await redis.expire(key, TTL);
    return;
  }
  let m = mem.h.get(key);
  if (!m) mem.h.set(key, (m = new Map()));
  m.set(field, JSON.stringify(val));
}

export async function hgetJSON(key, field) {
  if (redis) return (await redis.hget(key, field)) ?? null;
  const v = mem.h.get(key)?.get(field);
  return v ? JSON.parse(v) : null;
}

export async function hgetallJSON(key) {
  if (redis) return (await redis.hgetall(key)) || {};
  const out = {};
  const m = mem.h.get(key);
  if (m) for (const [k, v] of m) out[k] = JSON.parse(v);
  return out;
}

export const keys = {
  group: (code) => `picky:group:${code}`,
  members: (code) => `picky:members:${code}`,
  lock: (code) => `picky:lock:${code}`,
  placesCache: (lat, lng) => `picky:places:${lat.toFixed(3)},${lng.toFixed(3)}`,
};

export function normCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
