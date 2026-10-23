import assert from "node:assert/strict";
import { test } from "node:test";
import { TransitGraph } from "../src/lib/graph";
import { findRoutes } from "../src/lib/routing";
import { GraphEdge, OptimizationMode, RouteResult, StopDetail, WALKING_EDGE_BUS_ID } from "../src/lib/types";

type TestEdge = GraphEdge & {
  id: string;
  directionTypeId: number | null;
  fromSequence: number | null;
  toSequence: number | null;
};
type Leg = { from: number; edge: TestEdge };

function leg(from: number, to: number, bus: number, distance: number, time = distance,
  direction = 1, fromSequence = from, toSequence = to): Leg {
  const walking = bus === WALKING_EDGE_BUS_ID;
  return {
    from,
    edge: {
      id: `${from}:${to}:${bus}:${direction}:${fromSequence}:${toSequence}`,
      toStopId: to,
      busId: bus,
      busNumber: walking ? "walk" : String(bus),
      distance, time,
      fromStopName: `Stop ${from}`,
      toStopName: `Stop ${to}`,
      directionTypeId: walking ? null : direction,
      fromSequence: walking ? null : fromSequence,
      toSequence: walking ? null : toSequence,
    },
  };
}

class FixtureGraph extends TransitGraph {
  constructor(private readonly legs: Leg[]) { super(); }
  override getEdges(id: number): TestEdge[] {
    return this.legs.filter((entry) => entry.from === id).map((entry) => entry.edge);
  }
  override getStopInfo(id: number): StopDetail | undefined {
    if (!this.legs.some((entry) => entry.from === id || entry.edge.toStopId === id)) return;
    return { id, name: `Stop ${id}`, code: String(id), latitude: 40, longitude: 49 + id / 100, is_transport_hub: false };
  }
}

function stops(route: RouteResult): number[] {
  return route.segments.flatMap((segment, index) =>
    segment.stops.slice(index === 0 ? 0 : 1).map((stop) => stop.id));
}

for (const mode of ["shortest", "fastest", "balanced"] as const) {
  test(`${mode}: walking before the first bus has no transfer penalty`, () => {
    const graph = new FixtureGraph([
      leg(1, 2, -1, 0.1, 1), leg(2, 3, 10, 1, 1), leg(1, 3, 20, 1.3, 3),
    ]);
    const [route] = findRoutes(graph, 1, 3, mode, 1);
    assert.deepEqual(stops(route), [1, 2, 3]);
    assert.equal(route.totalTransfers, 0);
    assert.equal(route.totalTime, 2);
  });

  test(`${mode}: walking after the last bus has no transfer penalty`, () => {
    const graph = new FixtureGraph([
      leg(1, 2, 10, 1, 1), leg(2, 3, -1, 0.1, 1), leg(1, 3, 20, 1.3, 3),
    ]);
    assert.deepEqual(stops(findRoutes(graph, 1, 3, mode, 1)[0]), [1, 2, 3]);
  });

  test(`${mode}: a walking connection between buses incurs one transfer`, () => {
    const graph = new FixtureGraph([
      leg(1, 2, 10, 1, 1), leg(2, 3, -1, 0.1, 1),
      leg(3, 4, 20, 1, 1), leg(1, 4, 30, 3, 12.8),
    ]);
    const [route] = findRoutes(graph, 1, 4, mode, 1);
    assert.deepEqual(stops(route), [1, 2, 3, 4]);
    assert.equal(route.totalTransfers, 1);
    assert.equal(route.totalTime, 8);
    assert.equal(route.totalStops, 4);
  });
}

test("a direction change on the same bus line requires another boarding", () => {
  const graph = new FixtureGraph([
    leg(1, 2, 10, 1, 1, 1), leg(2, 3, 10, 1, 1, 2), leg(1, 3, 20, 3, 4),
  ]);
  assert.equal(findRoutes(graph, 1, 3, "fastest", 1)[0].segments[0].busId, 20);
  const [route] = findRoutes(new FixtureGraph([
    leg(1, 2, 10, 1, 1, 1), leg(2, 3, 10, 1, 1, 2),
  ]), 1, 3, "fastest", 1);
  assert.equal(route.segments.length, 2);
  assert.equal(route.totalTransfers, 1);
  assert.equal(route.totalTime, 7);
  assert.equal(route.totalStops, 3);
});

test("repeated physical stops do not allow skipping ahead on the same ride", () => {
  const graph = new FixtureGraph([
    leg(1, 2, 10, 1, 1, 1, 1, 2),
    leg(2, 3, 10, 1, 1, 1, 10, 11),
    leg(1, 3, 20, 3, 4),
  ]);
  assert.equal(findRoutes(graph, 1, 3, "fastest", 1)[0].segments[0].busId, 20);
});

test("boarding the same line after walking still counts as a transfer", () => {
  const [route] = findRoutes(new FixtureGraph([
    leg(1, 2, 10, 1), leg(2, 3, -1, 0.1), leg(3, 4, -1, 0.1), leg(4, 5, 10, 1),
  ]), 1, 5, "fastest", 1);
  assert.equal(route.totalTransfers, 1);
  assert.equal(route.totalTime, 7.2);
  assert.equal(route.totalStops, 4);
});

test("alternative paths contain their full root and are ranked by full cost", () => {
  const graph = new FixtureGraph([
    leg(1, 2, 10, 2), leg(2, 4, 10, 1),
    leg(2, 3, 10, 2), leg(3, 4, 10, 2), leg(1, 4, 20, 8),
  ]);
  const routes = findRoutes(graph, 1, 4, "fastest", 3);
  assert.deepEqual(routes.map(stops), [[1, 2, 4], [1, 2, 3, 4], [1, 4]]);
  assert.deepEqual(routes.map((route) => route.totalTime), [3, 6, 8]);
});

test("alternative search preserves the incoming bus at the spur stop", () => {
  const graph = new FixtureGraph([
    leg(1, 2, 10, 1), leg(2, 4, 10, 1), leg(2, 4, 20, 0.2),
    leg(2, 3, 10, 2), leg(3, 4, 10, 2),
  ]);
  const routes = findRoutes(graph, 1, 4, "fastest", 3);
  assert.deepEqual(routes.map((route) => route.totalTime), [2, 5, 6.2]);
  assert.deepEqual(routes.map(stops), [[1, 2, 4], [1, 2, 3, 4], [1, 2, 4]]);
});

test("parallel bus lines between the same stops remain distinct alternatives", () => {
  const routes = findRoutes(new FixtureGraph([
    leg(1, 2, 10, 1), leg(1, 2, 20, 2), leg(1, 2, 30, 3),
  ]), 1, 2, "fastest", 3);
  assert.deepEqual(routes.map((route) => route.segments[0].busId), [10, 20, 30]);
});

test("equal stop counts do not merge distinct alternative paths", () => {
  const routes = findRoutes(new FixtureGraph([
    leg(1, 2, 10, 1), leg(2, 4, 10, 1),
    leg(1, 3, 10, 2), leg(3, 4, 10, 2),
  ]), 1, 4, "fastest", 3);
  assert.deepEqual(routes.map(stops), [[1, 2, 4], [1, 3, 4]]);
});

test("walking-only journeys have no bus stops or transfer wait", () => {
  const [route] = findRoutes(new FixtureGraph([leg(1, 2, -1, 1), leg(2, 3, -1, 2)]), 1, 3, "fastest", 1);
  assert.equal(route.totalStops, 0);
  assert.equal(route.totalTransfers, 0);
  assert.equal(route.totalTime, 3);
});

test("unreachable and unknown stops return no paths", () => {
  const graph = new FixtureGraph([leg(1, 2, 10, 1), leg(3, 4, 10, 1)]);
  assert.deepEqual(findRoutes(graph, 1, 4, "fastest"), []);
  assert.deepEqual(findRoutes(graph, 99, 99, "fastest"), []);
});

test("nonpositive or noninteger route counts return no paths", () => {
  const graph = new FixtureGraph([leg(1, 2, 10, 1)]);
  for (const k of [0, -1, 1.5, NaN, Infinity]) {
    assert.deepEqual(findRoutes(graph, 1, 2, "fastest", k), []);
  }
});

function pathCost(path: TestEdge[], mode: OptimizationMode): number {
  let previous: TestEdge | undefined;
  let boarded = false;
  let cost = 0;
  for (const edge of path) {
    const walking = edge.busId === -1;
    const sameRide = previous && previous.busId === edge.busId &&
      previous.directionTypeId === edge.directionTypeId && previous.toSequence === edge.fromSequence;
    const transfer = !walking && boarded && !sameRide;
    if (mode === "shortest") cost += edge.distance + (transfer ? 0.5 : 0);
    if (mode === "fastest") cost += edge.time + (transfer ? 5 : 0);
    if (mode === "balanced") cost += 0.3 * edge.distance + 0.5 * edge.time + (transfer ? 5 : 0);
    if (!walking) boarded = true;
    previous = walking ? undefined : edge;
  }
  return cost;
}

test("all modes agree with exhaustive path enumeration on small directed graphs", () => {
  let seed = 12345;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }
  for (let sample = 0; sample < 12; sample++) {
    const legs: Leg[] = [];
    for (let from = 1; from < 6; from++) {
      for (let to = from + 1; to <= 6; to++) {
        for (const bus of [-1, 10, 20]) {
          if (random() < 0.3) legs.push(leg(from, to, bus, 0.1 + random() * 3, 0.1 + random() * 10));
        }
      }
    }
    const graph = new FixtureGraph(legs);
    const paths: TestEdge[][] = [];
    function visit(stop: number, path: TestEdge[]) {
      if (stop === 6) { paths.push(path); return; }
      for (const edge of graph.getEdges(stop)) visit(edge.toStopId, [...path, edge]);
    }
    visit(1, []);
    for (const mode of ["shortest", "fastest", "balanced"] as const) {
      const expected = paths.sort((a, b) => pathCost(a, mode) - pathCost(b, mode)).slice(0, 10);
      const actual = findRoutes(graph, 1, 6, mode, 10);
      assert.equal(actual.length, expected.length, `sample ${sample}, ${mode}`);
      for (let i = 0; i < actual.length; i++) {
        assert.deepEqual(stops(actual[i]), [1, ...expected[i].map((edge) => edge.toStopId)], `sample ${sample}, ${mode}, path ${i}`);
        assert.equal(actual[i].totalDistance, Math.round(expected[i].reduce((sum, edge) => sum + edge.distance, 0) * 100) / 100);
      }
    }
  }
});
