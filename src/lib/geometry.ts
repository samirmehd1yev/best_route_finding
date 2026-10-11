import { haversine } from "./geo";
import type { Coordinate, RouteCoordinate } from "./types";

const MAX_SNAP_DISTANCE_KM = 0.3;

interface Projection {
  position: number;
  point: Coordinate;
  distance: number;
}

function distance(a: Coordinate, b: Coordinate): number {
  return haversine(a.latitude, a.longitude, b.latitude, b.longitude);
}

function projections(stop: Coordinate | undefined, coordinates: Coordinate[]): Projection[] {
  const result: Projection[] = [];
  const add = (position: number, point: Coordinate) => {
    result.push({ position, point, distance: stop ? distance(stop, point) : Infinity });
  };
  add(0, coordinates[0]);
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    if (stop) {
      const scale = Math.cos(stop.latitude * Math.PI / 180);
      const x = (b.longitude - a.longitude) * scale;
      const y = b.latitude - a.latitude;
      const lengthSquared = x * x + y * y;
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        (((stop.longitude - a.longitude) * scale * x) + (stop.latitude - a.latitude) * y) / lengthSquared));
      if (t > 0 && t < 1) {
        add(i + t, {
          latitude: a.latitude + t * (b.latitude - a.latitude),
          longitude: a.longitude + t * (b.longitude - a.longitude),
        });
      }
    }
    add(i + 1, b);
  }
  return result;
}

export function polylineDistance(coordinates: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) total += distance(coordinates[i - 1], coordinates[i]);
  return total;
}

function matchStops(
  stops: Array<Coordinate | undefined>,
  coordinates: Coordinate[]
): { matches: Array<Projection | undefined>; cost: number } {
  const rows = stops.map((stop) => projections(stop, coordinates));
  const parents: Int32Array[] = [];
  let costs = new Float64Array(0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextCosts = new Float64Array(row.length);
    const parent = new Int32Array(row.length).fill(-1);
    let previousIndex = 0;
    let bestIndex = -1;
    let bestCost = Infinity;
    for (let j = 0; j < row.length; j++) {
      if (i > 0) {
        while (previousIndex < rows[i - 1].length && rows[i - 1][previousIndex].position <= row[j].position) {
          if (costs[previousIndex] < bestCost) {
            bestCost = costs[previousIndex];
            bestIndex = previousIndex;
          }
          previousIndex++;
        }
      }
      // Unmatched stops have a fixed cost so missing or corrupt coordinates
      // cannot pull the rest of the route away from its recorded flow.
      const snapCost = row[j].distance <= MAX_SNAP_DISTANCE_KM ? row[j].distance ** 2 : 1;
      nextCosts[j] = snapCost + (i === 0 ? 0 : bestCost);
      parent[j] = bestIndex;
    }
    parents.push(parent);
    costs = nextCosts;
  }

  let best = 0;
  for (let i = 1; i < costs.length; i++) if (costs[i] < costs[best]) best = i;
  const cost = costs[best];
  const matches: Array<Projection | undefined> = Array(stops.length);
  for (let i = stops.length - 1; i >= 0; i--) {
    const match = rows[i][best];
    if (match.distance <= MAX_SNAP_DISTANCE_KM) matches[i] = match;
    best = parents[i][best];
  }
  return { matches, cost };
}

export function routeLegGeometries(
  stops: Array<Coordinate | undefined>,
  routeCoordinates: RouteCoordinate[]
): Array<Coordinate[] | undefined> {
  if (stops.length < 2) return [];
  let coordinates: Coordinate[] = [...routeCoordinates].sort((a, b) => a.sequence_order - b.sequence_order);
  if (coordinates.length < 2) return Array(stops.length - 1).fill(undefined);

  const forward = matchStops(stops, coordinates);
  const reversedCoordinates = [...coordinates].reverse();
  const reversed = matchStops(stops, reversedCoordinates);
  // Some recorded polylines run opposite to their stop sequence.
  const matches = reversed.cost < forward.cost ? reversed.matches : forward.matches;
  if (reversed.cost < forward.cost) coordinates = reversedCoordinates;

  return matches.slice(0, -1).map((from, i) => {
    const to = matches[i + 1];
    if (!from || !to) return undefined;
    if (from.position === to.position && stops[i] && stops[i + 1] &&
      distance(stops[i]!, stops[i + 1]!) > 0.01) return undefined;
    const leg = [from.point];
    for (let j = Math.floor(from.position) + 1; j < to.position; j++) leg.push(coordinates[j]);
    leg.push(to.point);
    return leg;
  });
}
