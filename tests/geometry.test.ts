import assert from "node:assert/strict";
import { test } from "node:test";
import { EARTH_RADIUS_KM, haversine } from "../src/lib/geo";
import { polylineDistance, routeLegGeometries } from "../src/lib/geometry";
import type { Coordinate, RouteCoordinate } from "../src/lib/types";

const point = (latitude: number, longitude: number): Coordinate => ({ latitude, longitude });
const ordered = (points: Coordinate[]): RouteCoordinate[] => points.map((p, i) => ({ ...p, sequence_order: i + 1 }));
const positions = (points: Coordinate[]) => points.map(({ latitude, longitude }) => [latitude, longitude]);

test("route geometry retains bends between stops and measures the road distance", () => {
  const shape = [point(40, 49), point(40.01, 49), point(40.01, 49.02), point(40, 49.02)];
  const [leg] = routeLegGeometries([shape[0], shape[3]], ordered(shape));
  assert.deepEqual(positions(leg!), positions(shape));
  assert.ok(polylineDistance(leg!) > haversine(40, 49, 40, 49.02) * 2);
});

test("partial journeys clip the recorded flow at projected boarding and alighting positions", () => {
  const shape = [point(40, 49), point(40, 49.02), point(40.02, 49.02), point(40.02, 49.04)];
  const stops = [point(40, 49.01), point(40.01, 49.02)];
  const [leg] = routeLegGeometries(stops, ordered(shape));
  assert.deepEqual(positions(leg!), positions([stops[0], shape[1], stops[1]]));
});

test("polyline orientation follows the ordered bus stops even when storage is reversed", () => {
  const shape = [point(40, 49), point(40, 49.01), point(40.01, 49.01)];
  const [leg] = routeLegGeometries([shape[0], shape[2]], ordered([...shape].reverse()));
  assert.deepEqual(positions(leg!), positions(shape));
});

test("sequence_order determines geometry order without mutating the source", () => {
  const shape = [point(40, 49), point(40, 49.01), point(40.01, 49.01)];
  const coordinates = ordered(shape).reverse();
  const [leg] = routeLegGeometries([shape[0], shape[2]], coordinates);
  assert.deepEqual(positions(leg!), positions(shape));
  assert.equal(coordinates[0].sequence_order, 3);
});

test("loops match repeated stops in order without cutting across the loop", () => {
  const shape = [point(40, 49), point(40, 49.01), point(40.01, 49.01), point(40.01, 49), point(40, 49), point(39.99, 49)];
  const legs = routeLegGeometries([shape[0], shape[1], shape[4], shape[5]], ordered(shape));
  assert.deepEqual(positions(legs[1]!), positions(shape.slice(1, 5)));
  assert.deepEqual(positions(legs[2]!), positions(shape.slice(4)));
});

test("missing or distant stop coordinates do not distort the rest of the route", () => {
  const shape = [point(40, 49), point(40, 49.01), point(40, 49.02), point(40, 49.03)];
  for (const missing of [undefined, point(4, 49)]) {
    const legs = routeLegGeometries([shape[0], missing, shape[2], shape[3]], ordered(shape));
    assert.equal(legs[0], undefined);
    assert.equal(legs[1], undefined);
    assert.deepEqual(positions(legs[2]!), positions(shape.slice(2)));
  }
});

test("absent geometry returns an explicit fallback for each leg", () => {
  assert.deepEqual(routeLegGeometries([point(40, 49), point(40, 49.01)], []), [undefined]);
});

test("antipodal distances remain finite despite floating point rounding", () => {
  const distance = haversine(-88.40000000000009, 0, 88.40000000000009, 180);
  assert.ok(Number.isFinite(distance));
  assert.ok(Math.abs(distance - Math.PI * EARTH_RADIUS_KM) < 0.001);
});
