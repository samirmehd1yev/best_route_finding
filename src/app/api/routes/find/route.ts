import { NextRequest, NextResponse } from "next/server";
import { getGraph } from "@/lib/graph";
import { findRoutes } from "@/lib/routing";
import { isPositiveInteger } from "@/lib/validation";

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const { fromStopId, toStopId } = body ?? {};
  if (!isPositiveInteger(fromStopId) || !isPositiveInteger(toStopId)) {
    return NextResponse.json(
      { error: "fromStopId and toStopId must be positive integer IDs" },
      { status: 400 }
    );
  }
  try {
    if (fromStopId === toStopId) {
      return NextResponse.json(
        { error: "Start and destination must be different stops" },
        { status: 400 }
      );
    }

    const graph = await getGraph();

    const fromStop = graph.getStopInfo(fromStopId);
    const toStop = graph.getStopInfo(toStopId);

    if (!fromStop) {
      return NextResponse.json(
        { error: `Start stop ${fromStopId} not found` },
        { status: 404 }
      );
    }
    if (!toStop) {
      return NextResponse.json(
        { error: `Destination stop ${toStopId} not found` },
        { status: 404 }
      );
    }

    // Find the single best route (balanced: shortest + fastest).
    // k=1 short-circuits Yen's loop in findRoutes — only one Dijkstra runs.
    const routes = findRoutes(graph, fromStopId, toStopId, "balanced", 1);

    if (routes.length === 0) {
      return NextResponse.json(
        { error: "No route found between these stops" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      from: { id: fromStop.id, name: fromStop.name },
      to: { id: toStop.id, name: toStop.name },
      route: routes[0],
    });
  } catch (error) {
    console.error("Route finding failed:", error);
    return NextResponse.json(
      { error: "Route computation failed" },
      { status: 500 }
    );
  }
}
