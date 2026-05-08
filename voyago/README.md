# Voyago

Voyago now has:
- A Vite React frontend (`/swipe`) that displays restaurants and lets users rate them from 1-10.
- A lightweight recommendation backend (`backend/server.js`) that learns tag preferences from ratings.
- Catalog ingestion from your tagged JSON output (`../tagger/restaurants.tagged.json` by default).

## Run Locally

1. Frontend
```bash
npm run dev
```

2. Backend API (in a second terminal)
```bash
npm run api
```

The frontend proxies `/api/*` to `http://127.0.0.1:8787`.
The frontend also proxies `/transiter-api/*` to `http://127.0.0.1:8000` for route calls.

## API Endpoints

- `GET /api/health`
- `POST /api/catalog/import`
  - Optional body: `{ "filePath": "absolute/or/relative/path/to/restaurants.tagged.json" }`
- `GET /api/feed?user_id=demo-user&limit=10&exclude_ids=id1,id2`
- `POST /api/ratings`
  - Body: `{ "user_id": "demo-user", "restaurant_id": "abc", "rating": 8 }`

## Hack Club AI (Optional Insights)

The recommender core is deterministic/statistical for reliability.  
Optional profile insight generation can run every few ratings if you set:

- `HACKCLUB_API_KEY`
- `HACKCLUB_MODEL` (default: `gpt-4o-mini`)
- `HACKCLUB_BASE_URL` (default: `https://ai.hackclub.com/proxy/v1`)

## Production Routing

- `src/recommendationApi.js` defaults to same-origin `/api`
- `src/routingapi.js` defaults to same-origin `/transiter-api`

In production, configure these paths via Vercel rewrites (see `vercel.json`) so the user only visits one URL.

## Supabase (Render deployment)

Voyago backend can persist user profile state in Supabase using a single JSON row store.

Required env vars on `voyago-api`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STATE_TABLE` (optional, default: `voyago_state`)
