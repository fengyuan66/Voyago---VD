# Deploy Voyago + Transiter (One Judge URL)

This repo is now wired so your public entrypoint is a single Vercel URL, while APIs run on Render.

## 0) Create Supabase project (free)

1. Create a Supabase project.
2. Open SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy:
   - Project URL (`SUPABASE_URL`) https://flwnrsoralhulanztmsm.supabase.co
   - Service role key (`SUPABASE_SERVICE_ROLE_KEY`) eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd25yc29yYWxodWxhbnp0bXNtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI1MzMwOSwiZXhwIjoyMDkzODI5MzA5fQ.meO21Ju_-HX_pCCHfp03L_uwasxfmFrTEnhtnhH4PJ4

## 1) Push to GitHub

Push this whole workspace to one GitHub repo (including `render.yaml`, `voyago/`, and `transiter/backend/`).

## 2) Deploy both backends on Render (free)

1. In Render, create a new **Blueprint** from your GitHub repo.
2. Render will read `render.yaml` and create:
   - `voyago-api` (Node)
   - `transiter-api` (FastAPI)
3. Wait until both are live.
4. In `voyago-api` environment variables, set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Verify:
   - `https://voyago-api.onrender.com/api/health`
   - `https://transiter-api.onrender.com/health`

If Render changes either subdomain because the name is taken, copy the real URLs from Render.

## 3) Deploy frontend on Vercel

1. Create a Vercel project from the same GitHub repo.
2. Set **Root Directory** to `voyago`.
3. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Deploy.

## 4) If Render URL differs, update Vercel rewrites

Edit `voyago/vercel.json` destinations to your real Render domains, then redeploy Vercel:

- `/api/:path*` -> Voyago Render URL
- `/transiter-api/:path*` -> Transiter Render URL

## 5) Final judge URL

Send only your Vercel production URL, for example:

`https://your-project-name.vercel.app`

That single URL serves frontend + proxied API routes.
