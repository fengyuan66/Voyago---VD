For reference, these files are to be pulled almost daily in development. My PC does not have the space to be constantly doing these downloads, so the demo will run off the OSM / GTFS data at one timeframe only

downloadGtfsStatic and downloadOSMBC handles these. They are not in use in the current ship, but will be in broader deployment


Repo used -> Valhalla with OSM and Translink GTFS https://github.com/valhalla/valhalla


The current implementation uses pyvalhalla in the backend (voyago\backend), which is powered by FastAPI for the purpose of this ship. In future broad deployment I'll have to host it on some sort of server and use Docker to run Valhalla.

## Current backend behavior (`backend/app.py`)

`TRANSITER_ROUTER_MODE` controls routing strategy:

- `auto` (default): Valhalla if available, then OSRM, then straight-line fallback.
- `valhalla`: only Valhalla.
- `osrm`: only OSRM.
- `fallback`: only straight-line fallback.

Useful env vars:

- `TRANSITER_OSRM_BASE_URL` (default `https://router.project-osrm.org`)
- `TRANSITER_CORS_ORIGINS` (comma-separated origins or `*`)

