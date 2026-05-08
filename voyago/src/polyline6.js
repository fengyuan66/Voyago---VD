export function decodePolyline6(encoded) {
  if (!encoded || typeof encoded !== "string") {
    return [];
  }

  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = 1e6;
  const points = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const latChange = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const lonChange = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    lat += latChange;
    lon += lonChange;
    points.push([lat / factor, lon / factor]);
  }

  return points;
}
