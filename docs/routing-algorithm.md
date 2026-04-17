# Routing Algorithm

## Graph Model

The Baku bus network is modeled as a **weighted directed multigraph** G = (V, E):

- **Vertices (V):** Each physical bus stop from `stop_details` (3,444 stops)
- **Edges (E):** Two types of directed edges:
  1. **Bus edges:** Consecutive stops on a bus route (same direction). Multiple edges may exist between two stops served by different bus lines (multigraph property).
  2. **Walking edges:** Bidirectional connections between nearby stops within 300m that are served by at least one different bus route. `busId = -1`, `busNumber = "walk"`, walk speed: 4.5 km/h.
- **Edge Weights:** Distance (km) and time (minutes), combined via a mode-specific cost function.

## Graph Construction

Implemented in `src/lib/graph.ts` as the `TransitGraph` class.

### Step 1: Bus Route Edges

For each bus and each direction (forward=1, return=2), stops are sorted by `bus_stop_id` (ordinal position). Consecutive stops become directed edges:

```
For each (bus_id, direction_type_id) group in bus_stops:
  Sort stops by bus_stop_id ascending
  segmentTime = bus.duration_minuts / max(stopCount - 1, 1)

  For i = 0 to stopCount - 2:
    distance = haversine(stops[i], stops[i+1])
    Add edge: stops[i].stop_id -> stops[i+1].stop_id
      busId:      bus.id
      busNumber:  bus.number
      distance:   distance (km)
      time:       segmentTime (minutes, uniform per bus)
```

Time estimation is uniform: each bus's `duration_minuts` is divided equally across all segments in that direction. This is an approximation.

### Step 2: Walking Transfer Edges

An O(n^2) pass over all stop pairs with a quick lat/lng pre-filter:

```
For each pair (stopA, stopB) where A.index < B.index:
  if |A.lat - B.lat| > 0.004: skip          # ~400m quick filter
  if |A.lng - B.lng| > 0.005: skip
  dist = haversine(A, B)
  if dist > 0.3 km: skip
  if B has no bus route that A doesn't have: skip
  walkTime = (dist / 4.5) * 60              # minutes at 4.5 km/h
  Add bidirectional edges: A <-> B
    busId: -1, busNumber: "walk", distance: dist, time: walkTime
```

The "different bus" check ensures walking edges only connect stops where the walk provides access to a new bus line.

### Graph Caching

The graph is built once via `getGraph()` (module-level singleton). On Vercel serverless, it persists across requests within the same function instance. The `build()` method is idempotent — it no-ops if already built.

---

## Edge Weight / Cost Function

Implemented in `src/lib/routing.ts` function `edgeCost()`.

Three optimization modes exist, each with its own transfer penalty:

| Mode | Cost Formula | Transfer Penalty |
|------|-------------|-----------------|
| `shortest` | `edge.distance + penalty` | 0.5 km equivalent |
| `fastest` | `edge.time + penalty` | 5 minutes |
| `balanced` | `0.3 * edge.distance + 0.5 * edge.time + 0.2 * penalty` | 10 (composite units) |

Constants from code:

```typescript
TRANSFER_PENALTY_DISTANCE = 0.5  // km, used by "shortest"
TRANSFER_PENALTY_TIME     = 5    // minutes, used by "fastest"
// balanced: 0.2 * 10 = 2 composite units per transfer
```

A transfer is detected when the current bus ID is non-null and differs from the edge's bus ID. Walking edges (`busId = -1`) trigger a transfer penalty when switching from a bus.

The API exposes only **balanced** mode with `k=1` (single best route).

---

## Algorithm: Modified Dijkstra's

### State Space

Dijkstra operates over **expanded states** `(stopId, busId)` rather than just stop IDs. This allows tracking which bus the passenger is currently on, so transfer penalties are applied accurately.

- State key format: `"stopId:busId"` (e.g., `"1234:56"` or `"1234:null"` at the source)
- The source state is `(source, null)` — no bus yet

### Algorithm

```
function dijkstra(graph, source, target, mode, excludedEdges?, excludedNodes?):
  dist = Map<stateKey, number>
  prev = Map<stateKey, {prevState, edge}>
  pq = MinHeap<stateKey>

  startKey = "source:null"
  dist[startKey] = 0
  pq.push(startKey, 0)

  while pq is not empty:
    currentKey = pq.pop()
    (currentStop, currentBus) = parse(currentKey)
    currentDist = dist[currentKey]

    if currentStop == target:
      return reconstructPath(prev, currentKey)

    if excludedNodes contains currentStop (and != source): skip

    for each edge from currentStop:
      if excludedNodes contains edge.toStopId (and != target): skip
      if excludedEdges contains "currentStop->toStop:busId": skip

      isTransfer = (currentBus != null && currentBus != edge.busId)
      cost = edgeCost(edge, isTransfer, mode)
      nextKey = "edge.toStopId:edge.busId"
      newDist = currentDist + cost

      if newDist < dist[nextKey] (or nextKey unseen):
        dist[nextKey] = newDist
        prev[nextKey] = {currentKey, edge}
        pq.push(nextKey, newDist)

  return null  // no path
```

The `excludedEdges` and `excludedNodes` parameters support Yen's algorithm (see below).

### Priority Queue

A custom binary min-heap (`PriorityQueue<T>`) implemented in `routing.ts`. Supports `push(item, priority)` and `pop()`.

---

## Algorithm: Yen's K-Shortest Paths

Implemented in `src/lib/routing.ts` function `findRoutes()`. Default `k=3`, but the API calls it with `k=1`.

### Overview

1. Find the shortest path P1 using Dijkstra
2. For k = 2 to K:
   - For each node i in P(k-1):
     - Set spur node = P(k-1)[i]
     - Exclude edges from spur node that overlap with confirmed paths sharing the same root
     - Exclude root path nodes (before spur node) to force deviation
     - Run Dijkstra from spur node to target
     - If a new path is found and isn't a duplicate, add to candidates
   - Pick the lowest-cost candidate as Pk
3. Return [P1, ..., PK]

### Duplicate Detection

Candidate paths are checked against existing results by comparing segment count, bus IDs, and stop counts per segment. This prevents returning near-identical routes.

### Complexity

| Operation | Time | Space |
|-----------|------|-------|
| Graph construction | O(B*S + N^2) where B*S = bus_stops, N = stops | O(V + E) |
| Single Dijkstra | O((V*B + E) log(V*B)) where B = bus lines per stop | O(V*B) |
| Yen's k=1 | Same as single Dijkstra | O(V*B) |
| Yen's k=3 | O(K * P * ((V*B + E) log(V*B))) where P = path length | O(K * V*B) |

With our data: V = 3,444 stops, E ~ 11,702 bus edges + walking edges. The graph is small enough for sub-second query times.

---

## Path Reconstruction

Implemented in `reconstructRoute()`. Walks the `prev` map from target back to source, grouping consecutive edges by `busId` into segments:

```
function reconstructRoute(graph, pathKeys, prevMap):
  segments = []
  currentSegment = null

  for i = 1 to pathKeys.length - 1:
    edge = prevMap[pathKeys[i]].edge
    fromStop = graph.getStopInfo(parse(pathKeys[i-1]).stopId)
    toStop = graph.getStopInfo(edge.toStopId)

    if currentSegment is null or currentSegment.busId != edge.busId:
      push currentSegment to segments (if exists)
      currentSegment = new segment with busId, busNumber, starts with [fromStop]

    add toStop to currentSegment.stops
    accumulate distance and time

  push final currentSegment

  busSegments = segments where busId != -1
  return {
    segments,
    totalDistance: sum of segment distances (rounded to 2 decimals),
    totalTime: sum of segment times (rounded to 1 decimal),
    totalTransfers: max(0, busSegments.length - 1),
    totalStops: total bus stop count minus overlapping transfer stops
  }
```

### Transfer Counting

Only bus-to-bus changes count as transfers. Walking segments bridge bus segments but aren't counted as transfers themselves. `totalTransfers = busSegments.length - 1`.

---

## Haversine Distance

Implemented in `src/lib/geo.ts`:

```
d = 2 * R * arcsin(sqrt(sin^2(dlat/2) + cos(lat1) * cos(lat2) * sin^2(dlon/2)))
R = 6,371 km
```

Also provides `findNearbyStops(lat, lon, stops, radiusKm, limit)` — brute-force scan with distance filter and sort, used by the nearby stops API.

---

## API Integration

The route-finding API (`POST /api/routes/find`) calls:

```typescript
findRoutes(graph, fromStopId, toStopId, "balanced", 1)
```

It returns the single best route. The routing engine supports `k > 1` and other modes (`shortest`, `fastest`) internally but only `balanced` with `k=1` is exposed.
