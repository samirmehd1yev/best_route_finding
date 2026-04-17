import { TransitGraph } from "./graph";
import { GraphEdge, RouteResult, RouteSegment, OptimizationMode, WALKING_EDGE_BUS_ID } from "./types";

const TRANSFER_PENALTY_DISTANCE = 0.5; // km equivalent
const TRANSFER_PENALTY_TIME = 5; // minutes

// Min-heap priority queue
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
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

interface DijkstraState {
  stopId: number;
  busId: number | null;
}

interface PrevEntry {
  prevState: string;
  edge: GraphEdge;
}

function stateKey(state: DijkstraState): string {
  return `${state.stopId}:${state.busId ?? "null"}`;
}

function parseStateKey(key: string): DijkstraState {
  const parts = key.split(":");
  return {
    stopId: parseInt(parts[0]),
    busId: parts[1] === "null" ? null : parseInt(parts[1]),
  };
}

function edgeCost(edge: GraphEdge, isTransfer: boolean, mode: OptimizationMode): number {
  const transferPenalty = isTransfer
    ? (mode === "shortest" ? TRANSFER_PENALTY_DISTANCE : TRANSFER_PENALTY_TIME)
    : 0;

  switch (mode) {
    case "shortest":
      return edge.distance + transferPenalty;
    case "fastest":
      return edge.time + transferPenalty;
    case "balanced":
      return 0.3 * edge.distance + 0.5 * edge.time + 0.2 * (isTransfer ? 10 : 0);
  }
}

function dijkstra(
  graph: TransitGraph,
  source: number,
  target: number,
  mode: OptimizationMode,
  excludedEdges?: Set<string>
): { path: string[]; cost: number } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, PrevEntry>();
  const pq = new PriorityQueue<string>();

  const startKey = stateKey({ stopId: source, busId: null });
  dist.set(startKey, 0);
  pq.push(startKey, 0);

  while (pq.size > 0) {
    const currentKey = pq.pop()!;
    const currentState = parseStateKey(currentKey);
    const currentDist = dist.get(currentKey)!;

    if (currentState.stopId === target) {
      // Reconstruct path
      const path: string[] = [currentKey];
      let key = currentKey;
      while (prev.has(key)) {
        key = prev.get(key)!.prevState;
        path.unshift(key);
      }
      return { path, cost: currentDist };
    }

    const edges = graph.getEdges(currentState.stopId);
    for (const edge of edges) {
      // Check if edge is excluded (for Yen's algorithm)
      if (excludedEdges) {
        const edgeKey = `${currentState.stopId}->${edge.toStopId}:${edge.busId}`;
        if (excludedEdges.has(edgeKey)) continue;
      }

      const isTransfer =
        currentState.busId !== null && currentState.busId !== edge.busId;
      const cost = edgeCost(edge, isTransfer, mode);
      const nextState: DijkstraState = {
        stopId: edge.toStopId,
        busId: edge.busId,
      };
      const nextKey = stateKey(nextState);
      const newDist = currentDist + cost;

      if (!dist.has(nextKey) || newDist < dist.get(nextKey)!) {
        dist.set(nextKey, newDist);
        prev.set(nextKey, { prevState: currentKey, edge });
        pq.push(nextKey, newDist);
      }
    }
  }

  return null;
}

function reconstructRoute(
  graph: TransitGraph,
  pathKeys: string[],
  prevMap: Map<string, PrevEntry>
): RouteResult {
  // We need to reconstruct from the path keys and get the edges
  // Re-run to get the prev map properly
  const segments: RouteSegment[] = [];
  let currentSegment: RouteSegment | null = null;

  // Walk the path and collect edges
  for (let i = 1; i < pathKeys.length; i++) {
    const fromState = parseStateKey(pathKeys[i - 1]);
    const toState = parseStateKey(pathKeys[i]);
    const entry = prevMap.get(pathKeys[i]);
    if (!entry) continue;

    const edge = entry.edge;
    const fromStop = graph.getStopInfo(fromState.stopId);
    const toStop = graph.getStopInfo(edge.toStopId);

    if (!fromStop || !toStop) continue;

    if (!currentSegment || currentSegment.busId !== edge.busId) {
      // Start new segment
      if (currentSegment) {
        segments.push(currentSegment);
      }
      currentSegment = {
        busId: edge.busId,
        busNumber: edge.busNumber,
        stops: [
          {
            id: fromStop.id,
            name: edge.fromStopName || fromStop.name,
            latitude: fromStop.latitude,
            longitude: fromStop.longitude,
          },
        ],
        distance: 0,
        time: 0,
      };
    }

    currentSegment.stops.push({
      id: toStop.id,
      name: edge.toStopName || toStop.name,
      latitude: toStop.latitude,
      longitude: toStop.longitude,
    });
    currentSegment.distance += edge.distance;
    currentSegment.time += edge.time;
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  const totalDistance = segments.reduce((sum, s) => sum + s.distance, 0);
  const totalTime = segments.reduce((sum, s) => sum + s.time, 0);
  const busSegments = segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID);
  const totalStops = busSegments.reduce((sum, s) => sum + s.stops.length, 0) -
    Math.max(0, busSegments.length - 1);
  // Transfers = number of bus changes (walking segments connect bus segments)
  const totalTransfers = Math.max(0, busSegments.length - 1);

  return {
    segments,
    totalDistance: Math.round(totalDistance * 100) / 100,
    totalTime: Math.round(totalTime * 10) / 10,
    totalTransfers,
    totalStops,
  };
}

function dijkstraFull(
  graph: TransitGraph,
  source: number,
  target: number,
  mode: OptimizationMode,
  excludedEdges?: Set<string>,
  excludedNodes?: Set<number>
): { result: RouteResult; cost: number; pathStopIds: number[] } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, PrevEntry>();
  const pq = new PriorityQueue<string>();

  const startKey = stateKey({ stopId: source, busId: null });
  dist.set(startKey, 0);
  pq.push(startKey, 0);

  let targetKey: string | null = null;

  while (pq.size > 0) {
    const currentKey = pq.pop()!;
    const currentState = parseStateKey(currentKey);
    const currentDist = dist.get(currentKey)!;

    if (currentState.stopId === target) {
      targetKey = currentKey;
      break;
    }

    if (excludedNodes && excludedNodes.has(currentState.stopId) && currentState.stopId !== source) {
      continue;
    }

    const edges = graph.getEdges(currentState.stopId);
    for (const edge of edges) {
      if (excludedNodes && excludedNodes.has(edge.toStopId) && edge.toStopId !== target) {
        continue;
      }

      if (excludedEdges) {
        const edgeKey = `${currentState.stopId}->${edge.toStopId}:${edge.busId}`;
        if (excludedEdges.has(edgeKey)) continue;
      }

      const isTransfer =
        currentState.busId !== null && currentState.busId !== edge.busId;
      const cost = edgeCost(edge, isTransfer, mode);
      const nextState: DijkstraState = {
        stopId: edge.toStopId,
        busId: edge.busId,
      };
      const nextKey = stateKey(nextState);
      const newDist = currentDist + cost;

      if (!dist.has(nextKey) || newDist < dist.get(nextKey)!) {
        dist.set(nextKey, newDist);
        prev.set(nextKey, { prevState: currentKey, edge });
        pq.push(nextKey, newDist);
      }
    }
  }

  if (!targetKey) return null;

  // Reconstruct path keys
  const pathKeys: string[] = [targetKey];
  let key = targetKey;
  while (prev.has(key)) {
    key = prev.get(key)!.prevState;
    pathKeys.unshift(key);
  }

  const result = reconstructRoute(graph, pathKeys, prev);
  const pathStopIds = pathKeys.map((k) => parseStateKey(k).stopId);
  // Deduplicate consecutive same stop ids
  const uniqueStopIds: number[] = [];
  for (const id of pathStopIds) {
    if (uniqueStopIds.length === 0 || uniqueStopIds[uniqueStopIds.length - 1] !== id) {
      uniqueStopIds.push(id);
    }
  }

  return {
    result,
    cost: dist.get(targetKey)!,
    pathStopIds: uniqueStopIds,
  };
}

export function findRoutes(
  graph: TransitGraph,
  source: number,
  target: number,
  mode: OptimizationMode,
  k: number = 3
): RouteResult[] {
  const results: RouteResult[] = [];
  const candidatePaths: Array<{ result: RouteResult; cost: number; pathStopIds: number[] }> = [];

  // Step 1: Find shortest path
  const first = dijkstraFull(graph, source, target, mode);
  if (!first) return [];

  results.push(first.result);
  const confirmedPaths = [first];

  // Step 2: Yen's K-shortest paths
  for (let kIdx = 1; kIdx < k; kIdx++) {
    const prevPath = confirmedPaths[kIdx - 1];
    const prevStopIds = prevPath.pathStopIds;

    for (let i = 0; i < prevStopIds.length - 1; i++) {
      const spurNode = prevStopIds[i];
      const rootPath = prevStopIds.slice(0, i + 1);

      // Exclude edges from root path that overlap with confirmed paths
      const excludedEdges = new Set<string>();
      for (const confirmed of confirmedPaths) {
        const cStops = confirmed.pathStopIds;
        if (cStops.length > i + 1) {
          const rootMatch = rootPath.every((id, idx) => cStops[idx] === id);
          if (rootMatch) {
            // Find edges from spurNode in confirmed path and exclude them
            // We need bus info too - exclude all edges from spurNode to the next stop in confirmed path
            const fromId = cStops[i];
            const toId = cStops[i + 1];
            const edges = graph.getEdges(fromId);
            for (const edge of edges) {
              if (edge.toStopId === toId) {
                excludedEdges.add(`${fromId}->${toId}:${edge.busId}`);
              }
            }
          }
        }
      }

      // Exclude root path nodes (except spur node)
      const excludedNodes = new Set<number>();
      for (let j = 0; j < i; j++) {
        excludedNodes.add(rootPath[j]);
      }

      const spurResult = dijkstraFull(
        graph,
        spurNode,
        target,
        mode,
        excludedEdges,
        excludedNodes
      );

      if (spurResult) {
        // Check this isn't a duplicate
        const isDuplicate = [...results, ...candidatePaths.map((c) => c.result)].some(
          (existing) => {
            if (existing.segments.length !== spurResult.result.segments.length) return false;
            return existing.segments.every(
              (seg, idx) =>
                seg.busId === spurResult.result.segments[idx]?.busId &&
                seg.stops.length === spurResult.result.segments[idx]?.stops.length
            );
          }
        );

        if (!isDuplicate) {
          candidatePaths.push(spurResult);
        }
      }
    }

    if (candidatePaths.length === 0) break;

    // Pick the best candidate
    candidatePaths.sort((a, b) => a.cost - b.cost);
    const best = candidatePaths.shift()!;
    results.push(best.result);
    confirmedPaths.push(best);
  }

  return results;
}
