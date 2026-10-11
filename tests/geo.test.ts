import assert from "node:assert/strict";
import { test } from "node:test";
import { findNearbyStops } from "../src/lib/geo";
import { isPositiveInteger, numericParam } from "../src/lib/validation";
import type { StopDetail } from "../src/lib/types";

const stops: StopDetail[] = [0.003, 0.001, 0.02].map((offset, i) => ({
  id: i + 1, latitude: 40, longitude: 49 + offset, name: String(i), code: String(i), is_transport_hub: false,
}));

test("nearby stops are sorted by distance and obey the radius and limit", () => {
  assert.deepEqual(findNearbyStops(40, 49, stops, 1, 1).map((s) => s.id), [2]);
  assert.deepEqual(findNearbyStops(40, 49, stops, 1, 20).map((s) => s.id), [2, 1]);
  assert.equal(stops[0].id, 1);
});

test("invalid search coordinates, radii, and limits never produce nearby matches", () => {
  for (const [lat, lng, radius, limit] of [
    [NaN, 49, 1, 20], [91, 49, 1, 20], [40, 181, 1, 20], [40, Infinity, 1, 20],
    [40, 49, -1, 20], [40, 49, Infinity, 20], [40, 49, NaN, 20],
    [40, 49, 1, -1], [40, 49, 1, 0], [40, 49, 1, 1.5], [40, 49, 1, Infinity],
  ]) assert.deepEqual(findNearbyStops(lat, lng, stops, radius, limit), []);
});

test("nearby searches omit corrupt stop coordinates and allow an exact zero-radius match", () => {
  const invalid = { ...stops[0], latitude: 400 };
  const exact = { ...stops[1], latitude: 40, longitude: 49 };
  assert.deepEqual(findNearbyStops(40, 49, [invalid, exact], 0).map((s) => s.id), [2]);
});

test("numeric query parameters must parse completely and cannot be empty", () => {
  for (const value of ["", " ", "1stop", "1.2.3"]) assert.ok(Number.isNaN(numericParam(value)));
  assert.equal(numericParam(null, 20), 20);
  assert.equal(numericParam("0", 20), 0);
  assert.equal(numericParam(" 40.5 "), 40.5);
  for (const value of ["1", -1, 0, 1.5, Infinity, NaN, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isPositiveInteger(value), false);
  }
  assert.equal(isPositiveInteger(1439), true);
});
