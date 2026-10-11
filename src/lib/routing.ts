import type { TransitGraph } from "./graph";
import { GraphEdge, RouteResult, RouteSegment, OptimizationMode, WALKING_EDGE_BUS_ID } from "./types";

const TRANSFER_PENALTY_DISTANCE = 0.5; // km equivalent
const TRANSFER_PENALTY_TIME = 5; // minutes

class PriorityQueue<T> {
  private heap: Array<{ item: T; priority: number }> = [];

  push(item: T, priority: number) {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.item;
  }

  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].priority <= this.heap[i].priority) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private sinkDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

interface SearchState {
  stopId: number;
  busId: number | null;
  directionTypeId: number | null;
  sequence: number | null;
  hasBoarded: boolean;
}

interface Path {
  states: SearchState[];
  edges: GraphEdge[];
  prefixCosts: number[];
  cost: number;
}

function stateKey(state: SearchState): string {
  return `${state.stopId}:${state.busId}:${state.directionTypeId}:${state.sequence}:${state.hasBoarded}`;
}

function continuesRide(state: SearchState, edge: GraphEdge): boolean {
  return edge.busId !== WALKING_EDGE_BUS_ID && state.busId === edge.busId &&
    state.directionTypeId === edge.directionTypeId && state.sequence === edge.fromSequence;
}

function isTransfer(state: SearchState, edge: GraphEdge): boolean {
  return edge.busId !== WALKING_EDGE_BUS_ID && state.hasBoarded && !continuesRide(state, edge);
}

function nextState(state: SearchState, edge: GraphEdge): SearchState {
  const walking = edge.busId === WALKING_EDGE_BUS_ID;
  return {
    stopId: edge.toStopId,
    busId: walking ? null : edge.busId,
    directionTypeId: walking ? null : edge.directionTypeId,
    sequence: walking ? null : edge.toSequence,
    hasBoarded: state.hasBoarded || !walking,
  };
}

function edgeCost(edge: GraphEdge, transfer: boolean, mode: OptimizationMode): number {
  switch (mode) {
    case "shortest":
      return edge.distance + (transfer ? TRANSFER_PENALTY_DISTANCE : 0);
    case "fastest":
      return edge.time + (transfer ? TRANSFER_PENALTY_TIME : 0);
    case "balanced":
      return 0.3 * edge.distance + 0.5 * edge.time + (transfer ? 2 : 0);
  }
}

function transitionKey(state: SearchState, edge: GraphEdge): string {
  return `${stateKey(state)}|${edge.id}`;
}

function shortestPath(
  graph: TransitGraph,
  start: SearchState,
  target: number,
  mode: OptimizationMode,
  excludedTransitions = new Set<string>(),
  excludedStates = new Set<string>()
): Path | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, { state: SearchState; edge: GraphEdge }>();
  const pq = new PriorityQueue<{ state: SearchState; cost: number }>();
  dist.set(stateKey(start), 0);
  pq.push({ state: start, cost: 0 }, 0);

  while (pq.size > 0) {
    const { state, cost } = pq.pop()!;
    const key = stateKey(state);
    if (cost !== dist.get(key)) continue;

    if (state.stopId === target) {
      const states = [state];
      const edges: GraphEdge[] = [];
      let entry = prev.get(key);
      while (entry) {
        states.push(entry.state);
        edges.push(entry.edge);
        entry = prev.get(stateKey(entry.state));
      }
      states.reverse();
      edges.reverse();
      return { states, edges, prefixCosts: states.map((s) => dist.get(stateKey(s))!), cost };
    }

    for (const edge of graph.getEdges(state.stopId)) {
      if (excludedTransitions.has(transitionKey(state, edge))) continue;
      const next = nextState(state, edge);
      const nextKey = stateKey(next);
      if (excludedStates.has(nextKey)) continue;
      const newCost = cost + edgeCost(edge, isTransfer(state, edge), mode);
      if (newCost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, newCost);
        prev.set(nextKey, { state, edge });
        pq.push({ state: next, cost: newCost }, newCost);
      }
    }
  }
  return null;
}

function reconstructRoute(graph: TransitGraph, path: Path): RouteResult {
  const segments: RouteSegment[] = [];
  let currentSegment: RouteSegment | undefined;
  let totalTransfers = 0;

  for (let i = 0; i < path.edges.length; i++) {
    const edge = path.edges[i];
    const state = path.states[i];
    const fromStop = graph.getStopInfo(state.stopId)!;
    const toStop = graph.getStopInfo(edge.toStopId)!;
    const walking = edge.busId === WALKING_EDGE_BUS_ID;
    if (isTransfer(state, edge)) totalTransfers++;

    const continuesSegment = walking
      ? currentSegment?.busId === WALKING_EDGE_BUS_ID
      : continuesRide(state, edge);
    if (!currentSegment || !continuesSegment) {
      currentSegment = {
        busId: edge.busId,
        busNumber: edge.busNumber,
        directionTypeId: edge.directionTypeId,
        geometry: [],
        stops: [{
          id: fromStop.id,
          name: edge.fromStopName || fromStop.name,
          latitude: fromStop.latitude,
          longitude: fromStop.longitude,
        }],
        distance: 0,
        time: 0,
      };
      segments.push(currentSegment);
    }

    currentSegment.stops.push({
      id: toStop.id,
      name: edge.toStopName || toStop.name,
      latitude: toStop.latitude,
      longitude: toStop.longitude,
    });
    currentSegment.distance += edge.distance;
    currentSegment.time += edge.time;
    for (const point of edge.geometry ?? [fromStop, toStop]) {
      const last = currentSegment.geometry[currentSegment.geometry.length - 1];
      if (!last || last.latitude !== point.latitude || last.longitude !== point.longitude) {
        currentSegment.geometry.push({ latitude: point.latitude, longitude: point.longitude });
      }
    }
  }

  let totalStops = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.busId === WALKING_EDGE_BUS_ID) continue;
    totalStops += segment.stops.length;
    const previous = segments[i - 1];
    if (previous && previous.busId !== WALKING_EDGE_BUS_ID &&
      previous.stops[previous.stops.length - 1].id === segment.stops[0].id) totalStops--;
  }

  const totalDistance = segments.reduce((sum, s) => sum + s.distance, 0);
  const totalTime = segments.reduce((sum, s) => sum + s.time, 0) +
    totalTransfers * TRANSFER_PENALTY_TIME;
  return {
    segments,
    totalDistance: Math.round(totalDistance * 100) / 100,
    totalTime: Math.round(totalTime * 10) / 10,
    totalTransfers,
    totalStops,
  };
}

function pathKey(path: Path): string {
  return JSON.stringify(path.edges.map((edge) => edge.id));
}

export function findRoutes(
  graph: TransitGraph,
  source: number,
  target: number,
  mode: OptimizationMode,
  k: number = 3
): RouteResult[] {
  if (!Number.isInteger(k) || k <= 0 || !graph.getStopInfo(source) || !graph.getStopInfo(target)) return [];

  const first = shortestPath(graph, {
    stopId: source, busId: null, directionTypeId: null, sequence: null, hasBoarded: false,
  }, target, mode);
  if (!first) return [];

  const confirmed = [first];
  const candidates = new PriorityQueue<Path>();
  const seen = new Set([pathKey(first)]);

  while (confirmed.length < k) {
    const previous = confirmed[confirmed.length - 1];
    for (let i = 0; i < previous.edges.length; i++) {
      const rootEdges = previous.edges.slice(0, i);
      const spurState = previous.states[i];
      const excludedTransitions = new Set<string>();
      for (const path of confirmed) {
        if (path.edges.length > i && rootEdges.every((edge, j) => edge.id === path.edges[j].id)) {
          excludedTransitions.add(transitionKey(spurState, path.edges[i]));
        }
      }

      // Remove states already in the root, preserving distinct occurrences
      // of a physical stop along a bus route.
      const excludedStates = new Set(previous.states.slice(0, i).map(stateKey));
      const spur = shortestPath(graph, spurState, target, mode, excludedTransitions, excludedStates);
      if (!spur) continue;

      const rootCost = previous.prefixCosts[i];
      const candidate: Path = {
        states: [...previous.states.slice(0, i), ...spur.states],
        edges: [...rootEdges, ...spur.edges],
        prefixCosts: [
          ...previous.prefixCosts.slice(0, i),
          ...spur.prefixCosts.map((cost) => rootCost + cost),
        ],
        cost: rootCost + spur.cost,
      };
      const key = pathKey(candidate);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate, candidate.cost);
      }
    }

    const next = candidates.pop();
    if (!next) break;
    confirmed.push(next);
  }

  return confirmed.map((path) => reconstructRoute(graph, path));
}
