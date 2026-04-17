const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function findNearbyStops(
  lat: number,
  lon: number,
  stops: Array<{ id: number; latitude: number; longitude: number; name: string; code: string; is_transport_hub: boolean }>,
  radiusKm: number = 1.0,
  limit: number = 20
): Array<{ id: number; latitude: number; longitude: number; name: string; code: string; is_transport_hub: boolean; distance: number }> {
  const withDistance = stops
    .map((stop) => ({
      ...stop,
      distance: haversine(lat, lon, stop.latitude, stop.longitude),
    }))
    .filter((stop) => stop.distance <= radiusKm);

  withDistance.sort((a, b) => a.distance - b.distance);
  return withDistance.slice(0, limit);
}
