import { GraphEdge, StopDetail, Bus, BusStop, RouteCoordinate, RouteGeometry, WALKING_EDGE_BUS_ID, WALKING_EDGE_BUS_NUMBER } from "./types";
import { EARTH_RADIUS_KM, haversine } from "./geo";
import { polylineDistance, routeLegGeometries } from "./geometry";
import { queryStopDetails, queryBuses, queryBusStops, queryRoutes, queryAllRouteCoordinates } from "./db";

const WALK_RADIUS_KM = 0.3; // 300 meters
const WALK_SPEED_KMH = 4.5; // average walking speed
const WALK_LATITUDE_DELTA = (WALK_RADIUS_KM / EARTH_RADIUS_KM) * (180 / Math.PI);

export interface TransitData {
  stopDetails: StopDetail[];
  buses: Bus[];
  busStops: BusStop[];
  routeGeometries?: RouteGeometry[];
}

async function loadTransitData(): Promise<TransitData> {
  const [stopDetails, buses, busStops, routes, coordinates] = await Promise.all([
    queryStopDetails(), queryBuses(), queryBusStops(), queryRoutes(), queryAllRouteCoordinates(),
  ]);
  const byRoute = new Map<number, RouteCoordinate[]>();
  for (const coordinate of coordinates) {
    if (!byRoute.has(coordinate.route_id)) byRoute.set(coordinate.route_id, []);
    byRoute.get(coordinate.route_id)!.push(coordinate);
  }
  const routeGeometries = routes.map((route) => ({
    busId: route.bus_id,
    directionTypeId: route.direction_type_id,
    coordinates: byRoute.get(route.id) ?? [],
  }));
  return { stopDetails, buses, busStops, routeGeometries };
}

function uniqueRouteStops(stops: BusStop[]): BusStop[] {
  if (stops.length < 4) return stops;
  const prefix = new Array<number>(stops.length).fill(0);
  for (let i = 1; i < stops.length; i++) {
    let matched = prefix[i - 1];
    while (matched > 0 && stops[i].stop_id !== stops[matched].stop_id) matched = prefix[matched - 1];
    if (stops[i].stop_id === stops[matched].stop_id) matched++;
    prefix[i] = matched;
  }
  const period = stops.length - prefix[stops.length - 1];
  // Duplicate full sequences in a snapshot must not create a terminal-to-start
  // bus hop or divide the advertised duration across multiple copies.
  return period >= 2 && stops.length % period === 0 ? stops.slice(0, period) : stops;
}

export class TransitGraph {
  private adjacency: Map<number, GraphEdge[]> = new Map();
  private stopInfo: Map<number, StopDetail> = new Map();
  private busInfo: Map<number, Bus> = new Map();
  private built = false;
  private buildPromise: Promise<void> | null = null;

  constructor(private readonly loadData: () => Promise<TransitData> = loadTransitData) {}

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

  build(): Promise<void> {
    if (!this.buildPromise) {
      this.buildPromise = this.buildGraph().catch((error) => {
        this.adjacency.clear();
        this.stopInfo.clear();
        this.busInfo.clear();
        this.buildPromise = null;
        throw error;
      });
    }
    return this.buildPromise;
  }

  private async buildGraph(): Promise<void> {
    const { stopDetails, buses, busStops, routeGeometries = [] } = await this.loadData();
    const geometries = new Map(routeGeometries.map((route) => [
      `${route.busId}:${route.directionTypeId}`, route.coordinates,
    ]));

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
    for (const [key, grouped] of groupedStops.entries()) {
      const busId = parseInt(key.split(":")[0]);
      const bus = this.busInfo.get(busId);
      if (!bus) continue;

      const stops = uniqueRouteStops(grouped.sort((a, b) => a.bus_stop_id - b.bus_stop_id));
      const legGeometries = routeLegGeometries(
        stops.map((stop) => this.stopInfo.get(stop.stop_id)), geometries.get(key) ?? []
      );

      // The snapshot has no per-leg timings, so divide the route duration
      // evenly among its stop-to-stop hops.
      const segmentCount = Math.max(stops.length - 1, 1);
      const duration = Number.isFinite(bus.duration_minuts) && bus.duration_minuts > 0
        ? bus.duration_minuts : 30;
      const segmentTime = duration / segmentCount;

      for (let i = 0; i < stops.length - 1; i++) {
        const fromStop = stops[i];
        const toStop = stops[i + 1];

        const fromCoords = this.stopInfo.get(fromStop.stop_id);
        const toCoords = this.stopInfo.get(toStop.stop_id);

        if (!fromCoords || !toCoords) continue;

        const straightLineDistance = haversine(
          fromCoords.latitude,
          fromCoords.longitude,
          toCoords.latitude,
          toCoords.longitude
        );
        const reportedDistance = toStop.intermediate_distance;
        const geometry = legGeometries[i];
        const distance = reportedDistance !== null && Number.isFinite(reportedDistance) && reportedDistance > 0
          ? reportedDistance : geometry ? polylineDistance(geometry) : straightLineDistance;

        const edge: GraphEdge = {
          id: `bus:${key}:${fromStop.bus_stop_id}:${toStop.bus_stop_id}`,
          toStopId: toStop.stop_id,
          busId: bus.id,
          busNumber: bus.number,
          directionTypeId: fromStop.direction_type_id,
          fromSequence: fromStop.bus_stop_id,
          toSequence: toStop.bus_stop_id,
          geometry,
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

    // Footpaths depend on physical proximity, including opposite directions
    // of the same line and access to a journey's start or end stop.
    const stopsArray = Array.from(this.stopInfo.values());
    let walkingEdges = 0;

    for (let i = 0; i < stopsArray.length; i++) {
      const stopA = stopsArray[i];

      for (let j = i + 1; j < stopsArray.length; j++) {
        const stopB = stopsArray[j];

        // Latitude separation gives a safe lower bound at any longitude.
        if (Math.abs(stopA.latitude - stopB.latitude) > WALK_LATITUDE_DELTA) continue;

        const dist = haversine(
          stopA.latitude, stopA.longitude,
          stopB.latitude, stopB.longitude
        );

        if (dist > WALK_RADIUS_KM) continue;

        const walkTime = (dist / WALK_SPEED_KMH) * 60; // minutes

        // Add bidirectional walking edges
        const edgeAB: GraphEdge = {
          id: `walk:${stopA.id}:${stopB.id}`,
          toStopId: stopB.id,
          busId: WALKING_EDGE_BUS_ID,
          busNumber: WALKING_EDGE_BUS_NUMBER,
          directionTypeId: null,
          fromSequence: null,
          toSequence: null,
          distance: dist,
          time: walkTime,
          fromStopName: stopA.name,
          toStopName: stopB.name,
        };

        const edgeBA: GraphEdge = {
          id: `walk:${stopB.id}:${stopA.id}`,
          toStopId: stopA.id,
          busId: WALKING_EDGE_BUS_ID,
          busNumber: WALKING_EDGE_BUS_NUMBER,
          directionTypeId: null,
          fromSequence: null,
          toSequence: null,
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
  }
  await graphInstance.build();
  return graphInstance;
}
