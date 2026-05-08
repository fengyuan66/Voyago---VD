const TILE_SIZE = 256;
const MIN_ZOOM = 0;
const MAX_ZOOM = 18;

function lonToWorldX(lon, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  return ((lon + 180) / 360) * scale;
}

function latToWorldY(lat, zoom) {
  const safeLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const latRad = (safeLat * Math.PI) / 180;
  const mercator = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const scale = TILE_SIZE * 2 ** zoom;
  return (1 - mercator / Math.PI) * 0.5 * scale;
}

function pickZoom(points, width, height, padding) {
  const drawWidth = Math.max(width - padding * 2, 1);
  const drawHeight = Math.max(height - padding * 2, 1);

  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const xs = points.map(([, lon]) => lonToWorldX(lon, zoom));
    const ys = points.map(([lat]) => latToWorldY(lat, zoom));
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= drawWidth && spanY <= drawHeight) {
      return zoom;
    }
  }

  return MIN_ZOOM;
}

function buildMapProjection(points, width, height, padding) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const zoom = pickZoom(points, width, height, padding);
  const worldPoints = points.map(([lat, lon]) => ({
    x: lonToWorldX(lon, zoom),
    y: latToWorldY(lat, zoom),
  }));

  const minX = Math.min(...worldPoints.map((point) => point.x));
  const maxX = Math.max(...worldPoints.map((point) => point.x));
  const minY = Math.min(...worldPoints.map((point) => point.y));
  const maxY = Math.max(...worldPoints.map((point) => point.y));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const viewX0 = centerX - width / 2;
  const viewY0 = centerY - height / 2;
  const viewX1 = viewX0 + width;
  const viewY1 = viewY0 + height;

  const projectedPoints = worldPoints.map((point) => [point.x - viewX0, point.y - viewY0]);
  const polyline = projectedPoints.map(([x, y]) => `${x},${y}`).join(" ");

  const tileStartX = Math.floor(viewX0 / TILE_SIZE);
  const tileEndX = Math.floor(viewX1 / TILE_SIZE);
  const tileStartY = Math.floor(viewY0 / TILE_SIZE);
  const tileEndY = Math.floor(viewY1 / TILE_SIZE);
  const tileCount = 2 ** zoom;

  const tiles = [];
  for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
    for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) {
        continue;
      }

      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const x = tileX * TILE_SIZE - viewX0;
      const y = tileY * TILE_SIZE - viewY0;

      tiles.push({
        key: `${zoom}-${wrappedX}-${tileY}`,
        x,
        y,
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
      });
    }
  }

  return { zoom, projectedPoints, polyline, tiles };
}

function RouteMiniMap({ points }) {
  const width = 320;
  const height = 180;
  const padding = 20;

  const projection = buildMapProjection(points, width, height, padding);
  if (!projection) {
    return null;
  }

  const start = projection.projectedPoints[0];
  const end = projection.projectedPoints[projection.projectedPoints.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mini-map" role="img" aria-label="Route mini map">
      <defs>
        <clipPath id="mini-map-clip">
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
      </defs>

      <g clipPath="url(#mini-map-clip)">
        {projection.tiles.map((tile) => (
          <image
            key={tile.key}
            href={tile.href}
            x={tile.x}
            y={tile.y}
            width={TILE_SIZE}
            height={TILE_SIZE}
            preserveAspectRatio="none"
          />
        ))}
      </g>

      <rect x="0" y="0" width={width} height={height} fill="rgba(255,255,255,0.08)" stroke="#c8d3dd" />
      <polyline points={projection.polyline} fill="none" stroke="#1565c0" strokeWidth="3" />
      {start ? <circle cx={start[0]} cy={start[1]} r="4.5" fill="#2e7d32" /> : null}
      {end ? <circle cx={end[0]} cy={end[1]} r="4.5" fill="#c62828" /> : null}
      <text x={8} y={height - 8} fontSize="10" fill="#1f2d3a">
        © OpenStreetMap
      </text>
    </svg>
  );
}

export default RouteMiniMap;
