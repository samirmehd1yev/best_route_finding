import { GraphEdge, StopDetail, Bus, BusStop, WALKING_EDGE_BUS_ID, WALKING_EDGE_BUS_NUMBER } from "./types";
import { haversine } from "./geo";
import { queryStopDetails, queryBuses, queryBusStops } from "./db";

const WALK_RADIUS_KM = 0.3; // 300 meters
const WALK_SPEED_KMH = 4.5; // average walking speed

export class TransitGraph {
  private adjacency: Map<number, GraphEdge[]> = new Map();
  private stopInfo: Map<number, StopDetail> = new Map();
  private busInfo: Map<number, Bus> = new Map();
  private built = false;

  isBuilt(): boolean {
    return this.built;
  }

  getStopInfo(stopId: number): StopDetail | undefined {
    return this.stopInfo.get(stopId);
  }

  getAllStops(): StopDetail[] {
    return Array.from(this.stopInfo.values());
  }

  getBusInfo(busId: number): Bus | undefined {
    return this.busInfo.get(busId);
  }

  getEdges(stopId: number): GraphEdge[] {
    return this.adjacency.get(stopId) || [];
  }

  getAllStopIds(): number[] {
    return Array.from(this.adjacency.keys());
  }

  async build(): Promise<void> {
    if (this.built) return;

    const [stopDetails, buses, busStops] = await Promise.all([
      queryStopDetails(),
      queryBuses(),
      queryBusStops(),
    ]);

    // Index stop details
    for (const stop of stopDetails) {
      this.stopInfo.set(stop.id, stop);
    }

    // Index buses
    for (const bus of buses) {
      this.busInfo.set(bus.id, bus);
    }

    // Group bus_stops by (bus_id, direction_type_id)
    const groupedStops = new Map<string, BusStop[]>();
    for (const bs of busStops) {
      const key = `${bs.bus_id}:${bs.direction_type_id}`;
      if (!groupedStops.has(key)) {
        groupedStops.set(key, []);
      }
      groupedStops.get(key)!.push(bs);
    }

    // Build edges from consecutive stops on each bus route
    for (const [key, stops] of groupedStops.entries()) {
      const busId = parseInt(key.split(":")[0]);
      const bus = this.busInfo.get(busId);
      if (!bus) continue;

      stops.sort((a, b) => a.bus_stop_id - b.bus_stop_id);

      const segmentCount = Math.max(stops.length - 1, 1);
      const segmentTime = (bus.duration_minuts || 30) / segmentCount;

      for (let i = 0; i < stops.length - 1; i++) {
        const fromStop = stops[i];
        const toStop = stops[i + 1];

        const fromCoords = this.stopInfo.get(fromStop.stop_id);
        const toCoords = this.stopInfo.get(toStop.stop_id);

        if (!fromCoords || !toCoords) continue;

        const distance = haversine(
          fromCoords.latitude,
          fromCoords.longitude,
          toCoords.latitude,
          toCoords.longitude
        );

        const edge: GraphEdge = {
          toStopId: toStop.stop_id,
          busId: bus.id,
          busNumber: bus.number,
          distance,
          time: segmentTime,
          fromStopName: fromStop.stop_name,
          toStopName: toStop.stop_name,
        };

        if (!this.adjacency.has(fromStop.stop_id)) {
          this.adjacency.set(fromStop.stop_id, []);
        }
        this.adjacency.get(fromStop.stop_id)!.push(edge);
      }
    }

    // Ensure all stops have an entry in the adjacency list
    for (const stop of stopDetails) {
      if (!this.adjacency.has(stop.id)) {
        this.adjacency.set(stop.id, []);
      }
    }

    // Build walking transfer edges between nearby stops (within 300m)
    // Use a simple spatial approach: for each stop, find nearby stops
    const stopsArray = Array.from(this.stopInfo.values());
    let walkingEdges = 0;

    // Build a set of which stops are served by which buses
    const stopBuses = new Map<number, Set<number>>();
    for (const bs of busStops) {
      if (!stopBuses.has(bs.stop_id)) {
        stopBuses.set(bs.stop_id, new Set());
      }
      stopBuses.get(bs.stop_id)!.add(bs.bus_id);
    }

    for (let i = 0; i < stopsArray.length; i++) {
      const stopA = stopsArray[i];
      const busesA = stopBuses.get(stopA.id);

      for (let j = i + 1; j < stopsArray.length; j++) {
        const stopB = stopsArray[j];

        // Quick lat/lng filter before expensive haversine (0.3km ≈ 0.003 degrees)
        if (Math.abs(stopA.latitude - stopB.latitude) > 0.004) continue;
        if (Math.abs(stopA.longitude - stopB.longitude) > 0.005) continue;

        const dist = haversine(
          stopA.latitude, stopA.longitude,
          stopB.latitude, stopB.longitude
        );

        if (dist > WALK_RADIUS_KM) continue;

        // Only add walking edge if the two stops serve different bus routes
        // (no point walking between two stops on the same route)
        const busesB = stopBuses.get(stopB.id);
        if (busesA && busesB) {
          let hasDifferentBus = false;
          for (const b of busesB) {
            if (!busesA.has(b)) {
              hasDifferentBus = true;
              break;
            }
          }
          if (!hasDifferentBus) continue;
        }

        const walkTime = (dist / WALK_SPEED_KMH) * 60; // minutes

        // Add bidirectional walking edges
        const edgeAB: GraphEdge = {
          toStopId: stopB.id,
          busId: WALKING_EDGE_BUS_ID,
          busNumber: WALKING_EDGE_BUS_NUMBER,
          distance: dist,
          time: walkTime,
          fromStopName: stopA.name,
          toStopName: stopB.name,
        };

        const edgeBA: GraphEdge = {
          toStopId: stopA.id,
          busId: WALKING_EDGE_BUS_ID,
          busNumber: WALKING_EDGE_BUS_NUMBER,
          distance: dist,
          time: walkTime,
          fromStopName: stopB.name,
          toStopName: stopA.name,
        };

        this.adjacency.get(stopA.id)!.push(edgeAB);
        this.adjacency.get(stopB.id)!.push(edgeBA);
        walkingEdges += 2;
      }
    }

    this.built = true;
    const totalEdges = Array.from(this.adjacency.values()).reduce((sum, edges) => sum + edges.length, 0);
    console.log(
      `Graph built: ${this.adjacency.size} nodes, ${totalEdges} edges (${walkingEdges} walking)`
    );
  }
}

// Singleton instance cached at module level
let graphInstance: TransitGraph | null = null;

export async function getGraph(): Promise<TransitGraph> {
  if (!graphInstance) {
    graphInstance = new TransitGraph();
    await graphInstance.build();
  }
  return graphInstance;
}
