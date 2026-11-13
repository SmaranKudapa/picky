# picky

Ends the "idk, where do you want to eat?" loop. Phone-first web app.

**How it works:** make a group, everyone pitches, and the leader hits Find. The app pulls the real restaurants near the leader from OpenStreetMap, and an AI (OpenAI by default, Claude optional) picks the one spot that works for everyone. Everyone thumbs-up, then you get directions.

## Deploy to Vercel (about 5 minutes)

1. Push this folder to a GitHub repo, then go to **vercel.com → Add New → Project → import the repo**.
2. **Environment variables:** add `OPENAI_API_KEY`. (Or `ANTHROPIC_API_KEY` to use Claude instead.)
3. Deploy. Then go to **Project → Storage → Create Database → Upstash (Redis) → Connect to project**. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
4. **Redeploy**, under Deployments → ⋯ → Redeploy. Redis is required, because it's how the phones share live state.
5. Open the URL on your phone. When the leader hits Find, allow location access. If location is denied, it falls back to Chou Hall at UC Berkeley.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your OPENAI_API_KEY
npm run dev                  # http://localhost:3000 (in-memory store works locally)
```

## Where things live

| File | What it does |
|---|---|
| `app/page.js` | The whole phone UI: landing, pitch, waiting room, results, thumbs, directions |
| `app/MapView.js` | Leaflet map that marks every nearby place, stars the pick and crosses out the losers |
| `app/api/groups/...` | Create a group, poll the state, save your pitch/typing/thumb, and Find |
| `lib/places.js` | Real restaurants from OpenStreetMap (Overpass, no key). Caches the last good result |
| `lib/pick.js` | The AI call: OpenAI if `OPENAI_API_KEY` is set (model `OPENAI_MODEL`, default `gpt-5.4-mini`), else Claude if `ANTHROPIC_API_KEY` is set, else demo mode. Structured JSON output. Returns the winner, a reason per person, 2 backups and why the others lost. Every id is checked, and any bad reply, error or timeout falls back to the closest place |
| `lib/config.js` | Pitch limit (80 chars), default location, how long before a stuck "finding…" resets |

## Reliability (so the demo can't get stuck)
- Find fits inside Vercel's 60 s limit: OpenStreetMap gets about 15 s across its 3 mirrors, and the AI gets 35 s.
- If the AI fails in any way, the app still finishes Find with the closest place (shown as "Demo mode").
- If a Find dies partway, phones leave "finding…" after 75 s and the leader can hit Find again.
- The restaurant list is cached for 7 days. If OpenStreetMap is down, the app reuses the last good list from within 1.5 km.

## Demo tips
- Do one practice Find at the demo spot beforehand. The restaurant list gets cached, so the live demo still works if the map data service is slow.
- Phones sync every second, and "is typing" shows for 2.5 s after each keystroke.
