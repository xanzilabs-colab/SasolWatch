export type LatLon = [number, number];

export function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKm: number): LatLon {
  const radiusKm = 6371;
  const angularDistance = distanceKm / radiusKm;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lon * Math.PI) / 180;
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const targetLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude),
    );
  return [(targetLatitude * 180) / Math.PI, (targetLongitude * 180) / Math.PI];
}

export function buildCone(
  lat: number,
  lon: number,
  bearingDeg: number,
  halfWidthDeg: number,
  distanceKm: number,
): LatLon[] {
  const points: LatLon[] = [[lat, lon]];
  for (let angle = -halfWidthDeg; angle <= halfWidthDeg; angle += 5) {
    points.push(destinationPoint(lat, lon, bearingDeg + angle, distanceKm));
  }
  points.push(destinationPoint(lat, lon, bearingDeg + halfWidthDeg, distanceKm), [lat, lon]);
  return points;
}
