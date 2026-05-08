from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import json
import threading
import os
import math
from urllib import parse, request

try:
    from valhalla import Actor as ValhallaActor
    VALHALLA_IMPORT_ERROR = None
except Exception as import_error:
    ValhallaActor = None
    VALHALLA_IMPORT_ERROR = str(import_error)


app = FastAPI()

def _load_cors_origins():
    configured = os.getenv("TRANSITER_CORS_ORIGINS", "").strip()
    if configured:
        if configured == "*":
            return ["*"]
        parsed = [origin.strip() for origin in configured.split(",") if origin.strip()]
        if parsed:
            return parsed
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

#ALLOWED URLS. TWEAK THIS IN DEPLOYMENT
origins = _load_cors_origins()
#PERMISSION SETTINGS
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Hello world!"}

#DATA MODEL CONFIG
class Location(BaseModel):
    lat: float
    lon:float
class RouteRequest(BaseModel):
    locations: list[Location] = Field(min_length=2)
    costing: str = "auto" #routing mode
    date_time: dict | None = None

ROUTE_RETRY_RADIUS_METERS = 200
ROUTE_RETRY_MIN_REACHABILITY = 1
ROUTE_RETRY_SEARCH_CUTOFF_METERS = 35000
TRANSITER_ROUTER_MODE = os.getenv("TRANSITER_ROUTER_MODE", "auto").strip().lower() or "auto"
TRANSITER_OSRM_BASE_URL = os.getenv("TRANSITER_OSRM_BASE_URL", "https://router.project-osrm.org").rstrip("/")
FALLBACK_SPEED_KPH = {
    "auto": 35.0,
    "driving": 35.0,
    "pedestrian": 5.0,
    "walking": 5.0,
    "bicycle": 16.0,
    "cycling": 16.0,
}
TRANSITER_WALKING_STRATEGY = os.getenv("TRANSITER_WALKING_STRATEGY", "fallback").strip().lower() or "fallback"

BASE_PATH = Path(__file__).resolve().parent.parent
VALHALLA_CONFIG_PATH = BASE_PATH / "valhalla" / "valhalla.json"

actor: ValhallaActor | None = None
actor_error: str | None = None
actor_lock = threading.Lock()

def _build_actor_config():
    with VALHALLA_CONFIG_PATH.open("r", encoding="utf-8") as handle:
        config = json.load(handle)

    valhalla_root = BASE_PATH / "valhalla"
    mjolnir = config.setdefault("mjolnir", {})

    # Keep local development defaults, but allow cloud overrides through env vars.
    mjolnir["tile_dir"] = os.getenv("TRANSITER_TILE_DIR", str(valhalla_root / "tiles"))
    mjolnir["transit_dir"] = os.getenv("TRANSITER_TRANSIT_TILE_DIR", str(valhalla_root / "transit_tiles"))
    mjolnir["transit_feeds_dir"] = os.getenv("TRANSITER_GTFS_FEEDS_DIR", str(valhalla_root / "gtfs_feeds"))

    return config

def _should_attempt_valhalla() -> bool:
    return TRANSITER_ROUTER_MODE in ("auto", "valhalla")

if _should_attempt_valhalla():
    if ValhallaActor is None:
        actor_error = f"Valhalla import failed: {VALHALLA_IMPORT_ERROR}"
        print(f"Skipping Valhalla actor init: {actor_error}")
    else:
        try:
            actor = ValhallaActor(_build_actor_config())
        except Exception as e:
            actor_error = str(e)
            print(f"Failed to initialize Valhalla actor: {actor_error}")

def _decode_actor_result(result):
    if isinstance(result, bytes):
        result = result.decode("utf-8")

    if isinstance(result, str):
        return json.loads(result)

    return result

def _make_locations(points: list[Location], with_search_hints: bool):
    mapped = []
    for point in points:
        location = {
            "lat": point.lat,
            "lon": point.lon,
            "type": "break",
        }
        if with_search_hints:
            location["radius"] = ROUTE_RETRY_RADIUS_METERS
            location["minimum_reachability"] = ROUTE_RETRY_MIN_REACHABILITY
            location["search_cutoff"] = ROUTE_RETRY_SEARCH_CUTOFF_METERS
        mapped.append(location)
    return mapped

def _costing_to_osrm_profile(costing: str) -> str:
    normalized = (costing or "auto").strip().lower()
    if normalized in ("pedestrian", "walking"):
        return "walking"
    if normalized in ("bicycle", "cycling"):
        return "cycling"
    return "driving"

def _haversine_meters(a: Location, b: Location) -> float:
    earth_radius = 6371008.8
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    sin_dlat = math.sin(dlat / 2)
    sin_dlon = math.sin(dlon / 2)
    h = sin_dlat * sin_dlat + math.cos(lat1) * math.cos(lat2) * sin_dlon * sin_dlon
    return 2 * earth_radius * math.asin(min(1.0, math.sqrt(h)))

def _encode_polyline6(points: list[tuple[float, float]]) -> str:
    result = []
    prev_lat = 0
    prev_lon = 0
    for lat, lon in points:
        lat_e6 = int(round(lat * 1_000_000))
        lon_e6 = int(round(lon * 1_000_000))
        d_lat = lat_e6 - prev_lat
        d_lon = lon_e6 - prev_lon
        prev_lat = lat_e6
        prev_lon = lon_e6
        for value in (d_lat, d_lon):
            shifted = value << 1
            if value < 0:
                shifted = ~shifted
            while shifted >= 0x20:
                result.append(chr((0x20 | (shifted & 0x1F)) + 63))
                shifted >>= 5
            result.append(chr(shifted + 63))
    return "".join(result)

def _build_trip_payload(shape: str, duration_seconds: float, distance_meters: float):
    return {
        "trip": {
            "legs": [{"shape": shape}],
            "summary": {
                "time": max(1, int(round(duration_seconds))),
                "length": round(max(0.0, distance_meters) / 1000, 3),
            },
        }
    }

def _route_with_osrm(req: RouteRequest):
    profile = _costing_to_osrm_profile(req.costing)
    coordinates = ";".join(f"{point.lon},{point.lat}" for point in req.locations)
    encoded_coordinates = parse.quote(coordinates, safe=";,-.")
    url = (
        f"{TRANSITER_OSRM_BASE_URL}/route/v1/{profile}/{encoded_coordinates}"
        "?overview=full&geometries=polyline6&steps=false"
    )
    with request.urlopen(url, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if payload.get("code") != "Ok":
        raise RuntimeError(payload.get("message", "OSRM routing failed"))

    routes = payload.get("routes") or []
    if not routes:
        raise RuntimeError("OSRM returned no routes")
    primary = routes[0]
    geometry = primary.get("geometry")
    if not geometry:
        raise RuntimeError("OSRM response missing geometry")
    duration = float(primary.get("duration", 0.0))
    distance = float(primary.get("distance", 0.0))
    return _build_trip_payload(geometry, duration, distance)

def _route_with_fallback(req: RouteRequest):
    points = [(point.lat, point.lon) for point in req.locations]
    if len(points) < 2:
        raise RuntimeError("Need at least two points")

    total_distance_m = 0.0
    for index in range(len(req.locations) - 1):
        total_distance_m += _haversine_meters(req.locations[index], req.locations[index + 1])

    normalized_costing = (req.costing or "auto").strip().lower()
    speed_kph = FALLBACK_SPEED_KPH.get(normalized_costing, FALLBACK_SPEED_KPH["auto"])
    speed_mps = max(0.1, speed_kph * (1000 / 3600))
    duration_seconds = total_distance_m / speed_mps
    shape = _encode_polyline6(points)
    return _build_trip_payload(shape, duration_seconds, total_distance_m)

@app.post("/route")
def route(req: RouteRequest):
    errors = []
    normalized_costing = (req.costing or "auto").strip().lower()

    if actor is not None:
        attempts = [
            {
                "locations": _make_locations(req.locations, with_search_hints=False),
                "costing": req.costing,
            },
            {
                "locations": _make_locations(req.locations, with_search_hints=True),
                "costing": req.costing,
            },
        ]
        if req.date_time:
            for payload in attempts:
                payload["date_time"] = req.date_time

        for payload in attempts:
            try:
                # pyvalhalla Actor wraps native code; guard shared instance against concurrent access
                # to avoid process-level crashes from overlapping requests.
                with actor_lock:
                    result = actor.route(payload)
                return _decode_actor_result(result)
            except Exception as error:
                errors.append(f"valhalla: {error}")

    if (
        normalized_costing in ("pedestrian", "walking")
        and TRANSITER_WALKING_STRATEGY == "fallback"
        and TRANSITER_ROUTER_MODE in ("auto", "osrm", "fallback")
    ):
        try:
            return _route_with_fallback(req)
        except Exception as error:
            errors.append(f"walking-fallback: {error}")

    if TRANSITER_ROUTER_MODE in ("auto", "osrm"):
        try:
            return _route_with_osrm(req)
        except Exception as error:
            errors.append(f"osrm: {error}")

    if TRANSITER_ROUTER_MODE in ("auto", "fallback"):
        try:
            return _route_with_fallback(req)
        except Exception as error:
            errors.append(f"fallback: {error}")

    message = "; ".join(errors) if errors else "No routing engine available"
    if "no suitable edges near location" in message.lower():
        raise HTTPException(
            status_code=422,
            detail=(
                "Routing failed: one or more points are off-road or outside the currently loaded routing tiles. "
                "Set HQ to a nearby Vancouver street address."
            ),
        )

    raise HTTPException(status_code=503, detail=f"Routing failed: {message}")
    
#debug
@app.get("/health")
def health():
    return {
        "router_mode": TRANSITER_ROUTER_MODE,
        "actor_presence": actor is not None,
        "valhalla_import_error": VALHALLA_IMPORT_ERROR,
        "config_path": str(VALHALLA_CONFIG_PATH),
        "actor_error": actor_error,
        "osrm_base_url": TRANSITER_OSRM_BASE_URL,
    }

