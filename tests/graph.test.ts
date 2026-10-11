import assert from "node:assert/strict";
import { test } from "node:test";
import { TransitData, TransitGraph, getGraph } from "../src/lib/graph";
import { haversine } from "../src/lib/geo";
import { findRoutes } from "../src/lib/routing";
import type { Bus, BusStop, StopDetail } from "../src/lib/types";

function stop(id: number, latitude = 40, longitude = 49 + id / 10): StopDetail {
  return { id, name: `Stop ${id}`, code: String(id), latitude, longitude, is_transport_hub: false };
}
function bus(id: number, duration = 20): Bus {
  return { id, number: String(id), carrier: "", first_point: "", last_point: "", route_length: 2,
    tariff: 60, tariff_str: "", region_id: 1, working_zone_type_id: 1, duration_minuts: duration };
}
function routeStops(busId: number, ids: number[], direction = 1, start = 1): BusStop[] {
  return ids.map((id, i) => ({
    id: start + i, bus_stop_id: start + i, bus_id: busId, stop_id: id,
    stop_code: String(id), stop_name: `Stop ${id}`, direction_type_id: direction,
    intermediate_distance: null, total_distance: 2,
  }));
}
async function graph(data: TransitData): Promise<TransitGraph> {
  const graph = new TransitGraph(async () => data);
  await graph.build();
  return graph;
}

test("walking connections are independent of stop order and bus-set containment", async () => {
  const stops = [stop(1, 40, 49), stop(2, 40, 49.001), stop(3), stop(4)];
  const data = {
    stopDetails: stops, buses: [bus(10), bus(20)],
    busStops: [...routeStops(10, [1, 3]), ...routeStops(10, [2, 3], 2), ...routeStops(20, [1, 4])],
  };
  for (const stopDetails of [stops, [...stops].reverse()]) {
    const g = await graph({ ...data, stopDetails });
    assert.ok(g.getEdges(1).some((e) => e.busId === -1 && e.toStopId === 2));
    assert.ok(g.getEdges(2).some((e) => e.busId === -1 && e.toStopId === 1));
  }
});

test("nearby stops served by the same line still have a walking connection", async () => {
  const g = await graph({
    stopDetails: [stop(1, 40, 49), stop(2, 40, 49.001)],
    buses: [bus(10)], busStops: routeStops(10, [1, 2]),
  });
  assert.ok(g.getEdges(2).some((e) => e.busId === -1 && e.toStopId === 1));
});

test("walking can reach an unserved destination but cannot exceed the radius", async () => {
  const g = await graph({ stopDetails: [stop(1, 40, 49), stop(2, 40, 49.001), stop(3)], buses: [], busStops: [] });
  assert.equal(findRoutes(g, 1, 2, "fastest", 1).length, 1);
  assert.equal(findRoutes(g, 1, 3, "fastest", 1).length, 0);
});

test("walking connections work at high latitudes and across the date line", async () => {
  for (const stops of [[stop(1, 89, 0), stop(2, 89, 0.1)], [stop(1, 0, 179.999), stop(2, 0, -179.999)]]) {
    const g = await graph({ stopDetails: stops, buses: [], busStops: [] });
    assert.equal(g.getEdges(1)[0].toStopId, 2);
  }
});

test("bus edges retain stop order, direction, and supplied road distances", async () => {
  const sequence = routeStops(10, [1, 2, 3]);
  sequence[1].intermediate_distance = 1.5;
  sequence[2].intermediate_distance = 2.5;
  const g = await graph({ stopDetails: [stop(1), stop(2), stop(3)], buses: [bus(10)], busStops: sequence.reverse() });
  assert.equal(g.getEdges(1)[0].toStopId, 2);
  assert.equal(g.getEdges(1)[0].fromSequence, 1);
  assert.equal(g.getEdges(1)[0].toSequence, 2);
  assert.equal(g.getEdges(1)[0].directionTypeId, 1);
  const [result] = findRoutes(g, 1, 3, "fastest", 1);
  assert.equal(result.totalDistance, 4);
  assert.equal(result.totalTime, 20);
  assert.equal(result.totalTransfers, 0);
});

test("duplicate full stop sequences do not create terminal shortcuts or halve travel time", async () => {
  const g = await graph({ stopDetails: [stop(1), stop(2), stop(3)], buses: [bus(10)],
    busStops: [...routeStops(10, [1, 2, 3]), ...routeStops(10, [1, 2, 3], 1, 20)] });
  assert.deepEqual(g.getEdges(3), []);
  assert.equal(g.getEdges(1).length, 1);
  assert.equal(findRoutes(g, 1, 3, "fastest", 1)[0].totalTime, 20);
});

test("a repeated stop within a genuine loop is preserved", async () => {
  const g = await graph({ stopDetails: [stop(1), stop(2), stop(3)], buses: [bus(10)], busStops: routeStops(10, [1, 2, 1, 3]) });
  assert.equal(g.getEdges(1).length, 2);
  assert.equal(g.getEdges(2)[0].toStopId, 1);
});

test("road geometry reaches the result in the selected direction and between selected stops", async () => {
  const stops = [stop(1, 40, 49), stop(2, 40, 49.02), stop(3, 40, 49.04)];
  const shape = [stops[0], stop(10, 40.01, 49), stop(11, 40.01, 49.02), stops[1], stop(12, 40.01, 49.04), stops[2]];
  const g = await graph({ stopDetails: stops, buses: [bus(10)], busStops: routeStops(10, [1, 2, 3]),
    routeGeometries: [{ busId: 10, directionTypeId: 1, coordinates: shape.map((p, i) => ({ ...p, sequence_order: i })) }] });
  const [result] = findRoutes(g, 1, 2, "fastest", 1);
  assert.equal(result.segments[0].geometry.length, 4);
  assert.equal(result.segments[0].directionTypeId, 1);
  assert.deepEqual(result.segments[0].geometry.at(-1), { latitude: stops[1].latitude, longitude: stops[1].longitude });
  assert.ok(result.totalDistance > haversine(40, 49, 40, 49.02) * 2);
  assert.equal(findRoutes(g, 2, 3, "fastest", 1)[0].segments[0].geometry.length, 3);
});

test("concurrent builds share one load and wait for a complete graph", async () => {
  let release!: (data: TransitData) => void;
  let loads = 0;
  const pending = new Promise<TransitData>((resolve) => { release = resolve; });
  const g = new TransitGraph(() => { loads++; return pending; });
  const first = g.build();
  const second = g.build();
  assert.equal(first, second);
  assert.equal(g.isBuilt(), false);
  release({ stopDetails: [stop(1), stop(2)], buses: [bus(10)], busStops: routeStops(10, [1, 2]) });
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(g.isBuilt(), true);
  assert.equal(g.getEdges(1).length, 1);
});

test("a failed build can be retried without exposing partial data", async () => {
  let loads = 0;
  const g = new TransitGraph(async () => {
    if (loads++ === 0) throw new Error("load failed");
    return { stopDetails: [stop(1), stop(2)], buses: [bus(10)], busStops: routeStops(10, [1, 2]) };
  });
  await assert.rejects(g.build(), /load failed/);
  assert.equal(g.isBuilt(), false);
  assert.deepEqual(g.getAllStopIds(), []);
  await g.build();
  assert.equal(g.isBuilt(), true);
  assert.equal(g.getEdges(1).length, 1);
});

test("the bundled database produces complete routes with recorded road geometry", async () => {
  const [a, b] = await Promise.all([getGraph(), getGraph()]);
  assert.equal(a, b);
  assert.ok(a.isBuilt());
  for (const id of [3838, 3839]) {
    assert.ok(a.getStopInfo(id)!.latitude > 40);
    const ride = a.getEdges(id).find((edge) => edge.busId === 189)!;
    assert.ok(ride.distance > 0 && ride.distance < 2);
    assert.ok(ride.geometry && ride.geometry.length > 2);
  }
  for (const [from, to] of [[1439, 631], [105, 1439]]) {
    const [result] = findRoutes(a, from, to, "balanced", 1);
    assert.equal(result.segments[0].stops[0].id, from);
    assert.equal(result.segments.at(-1)!.stops.at(-1)!.id, to);
    assert.ok(result.segments.some((s) => s.busId !== -1 && s.geometry.length > s.stops.length));
    assert.ok(Number.isFinite(result.totalDistance));
  }
});
