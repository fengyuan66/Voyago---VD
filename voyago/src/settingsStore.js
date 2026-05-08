const HQ_KEY = "voyago.hq";
const ROUTING_COVERAGE = Object.freeze({
  minLat: 48.9,
  maxLat: 49.5,
  minLon: -123.5,
  maxLon: -122.3,
});

function parseHq(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lon = Number(parsed?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return {
      label: typeof parsed?.label === "string" ? parsed.label : "",
      lat,
      lon,
    };
  } catch {
    return null;
  }
}

export function isWithinRoutingCoverage(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= ROUTING_COVERAGE.minLat &&
    lat <= ROUTING_COVERAGE.maxLat &&
    lon >= ROUTING_COVERAGE.minLon &&
    lon <= ROUTING_COVERAGE.maxLon
  );
}

export function getRoutingCoverageBounds() {
  return ROUTING_COVERAGE;
}
export function getHQFromStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return parseHq(window.localStorage.getItem(HQ_KEY));
}

export function saveHQToStorage(hq) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(HQ_KEY, JSON.stringify(hq));
}
