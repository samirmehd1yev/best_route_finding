# Routing Algorithm

## Graph construction

`src/lib/graph.ts` builds a directed multigraph from the SQLite snapshot.
Physical stops are nodes; bus legs and nearby walking connections are edges.

Bus stops are grouped by bus and direction, then sorted by `bus_stop_id`.
Exact repetitions of a complete stop sequence are collapsed to one copy.
This prevents duplicated snapshot rows from creating a terminal-to-start
shortcut or dividing the route duration across duplicate copies. Individual
repeated stops within a route remain distinct occurrences.

Each bus edge retains its bus ID, direction, source and destination sequence
positions, and a unique edge ID. These distinguish parallel services and
repeated visits to the same physical stop.

Distance is chosen in this order:

1. A finite, positive `intermediate_distance` supplied for the destination stop.
2. Length of the recorded road geometry between the two stops.
3. Great-circle distance between the stops if neither is usable.

Time remains an estimate: a positive `duration_minuts` is divided evenly
among the direction's legs. A missing or invalid duration defaults to
30 minutes. The data does not supply per-leg traffic or scheduled departures.

Walking edges connect every pair of physical stops within 300 m in both
directions, at 4.5 km/h. This includes stops served by the same line,
opposite directions, and access to a start or destination stop. Connectivity
does not depend on input order or which bus set contains the other.
A latitude-distance lower bound avoids unnecessary distance calculations
without rejecting connections near the poles or across the date line.
The limit applies to each walking edge; successive walking legs are allowed.

## Recorded road geometry

`src/lib/geometry.ts` aligns the ordered stop sequence with the route's
`route_coordinates`. It considers projections onto polyline segments and
the recorded vertices. Dynamic programming chooses nondecreasing positions
along the flow, so repeated stops and loops retain their travel order.

Both polyline orientations are evaluated because some stored flows run
opposite to their stop sequence. The orientation with the lower matching
cost is used. Matching minimizes squared snap distance; positions more
than 300 m from a stop receive a fixed unmatched cost. This prevents one
missing or corrupt stop coordinate from dominating the alignment.

Each bus edge receives only its portion of the flow, clipped at the two
matched stop positions. Missing or unmatched geometry falls back to the
stop coordinates. Road distance sums Haversine distances along the matched
polyline instead of measuring a direct line between its endpoints.

During reconstruction, adjacent edge geometries are concatenated and shared
boundary coordinates are removed. Every `RouteSegment` includes
`directionTypeId` and `geometry: { latitude, longitude }[]`.
`Map.tsx` draws these coordinates and includes them in its viewport bounds.
Walking segments remain direct, dashed connections; the database does not
contain pedestrian paths.

## Cache and initialization

`getGraph()` always awaits `build()`. Concurrent requests share the same
build promise and receive the completed graph. A failed load clears partial
indexes and permits a later retry. A successful graph is reused for the
lifetime of the process.

## Search state and transfers

Dijkstra uses the state:

```
(stopId, busId, directionTypeId, sequence, hasBoarded)
```

At the source, the passenger is off the bus and `hasBoarded` is false.
Walking clears the current bus, direction, and sequence while preserving
whether a bus has already been used.

A bus edge continues a ride only when its bus, direction, and starting
sequence match the current state. Otherwise it is a new boarding:

- The first boarding has no transfer penalty, including after an initial walk.
- A later boarding incurs one transfer penalty.
- Walking itself incurs no transfer penalty.
- Changing direction, boarding again after walking, or boarding at another
  occurrence of the same stop requires a new ride, even on the same line.

This applies the same transfer definition in search and reconstruction.

## Optimization costs

For distance `d` in km, travel time `t` in minutes, and transfer indicator
`x` (0 or 1):

| Mode | Edge cost |
|------|-----------|
| `shortest` | `d + 0.5 * x` |
| `fastest` | `t + 5 * x` |
| `balanced` | `0.3 * d + 0.5 * t + 5 * x` |

These are preference scores; shortest mode includes a transfer preference.
Balanced mode uses its own transfer weight. Reported journey duration
includes a five-minute wait per transfer in every mode, while segment
times contain travel time only.

The binary min-heap retains each queued distance. Stale entries are skipped
when a better distance to the same state has already been found.
All edge costs are nonnegative, allowing termination when a target state
is removed from the queue.

## Alternative routes

`findRoutes(graph, source, target, mode, k)` uses Yen's algorithm over
expanded states. The default is three routes; the API requests only one.

For each deviation from the last confirmed path:

1. Preserve the root's exact edges, accumulated cost, and full incoming state.
2. Exclude only the specific transition used by confirmed paths with that root.
3. Exclude root states preceding the spur state.
4. Search from the spur state with its existing boarding context.
5. Join the root and spur and queue the candidate by its complete cost.

Candidates persist between iterations. Duplicate detection uses the complete
ordered edge IDs, so different lines between the same stops and different
paths with equal stop counts remain eligible.

Returned paths are loopless in expanded state space. A physical stop may
appear again at a different position on a looping route. Unknown endpoints,
unreachable targets, and nonpositive or noninteger `k` return no routes.
A known source equal to the target produces an empty, zero-cost journey.

## Journey totals

Continuous rides and consecutive walking edges are grouped into segments.
New boardings start new bus segments even when the bus number is unchanged.

- `totalDistance`: sum of travel distances, rounded to two decimals.
- `totalTime`: sum of travel times plus five minutes per transfer, rounded
  to one decimal.
- `totalTransfers`: number of boardings after the first.
- `totalStops`: stops visited on bus segments, removing a shared boundary
  only for adjacent bus segments at the same physical stop. Distinct stops
  joined by walking are both counted. Walking-only journeys have zero bus stops.

## Complexity

For a route with R stops and P geometry points, geometry alignment takes
O(RP) time and space. Walking construction takes O(N²) for N physical stops.

Let S be the number of expanded search states, T the number of transitions,
and L the path length. Heap-based Dijkstra takes O((S + T) log(S + T));
Yen performs at most O(KL) such searches for K results. With K=1, the
alternative-route loop is skipped.

## Verification

Run `npm test` for deterministic regression cases, exhaustive enumeration
of small directed graphs in all three modes, geometry alignment checks,
concurrent initialization, and integration with the bundled SQLite data.
Run `npm run typecheck` and `npm run build` for application validation.
