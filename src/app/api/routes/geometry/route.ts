import { NextRequest, NextResponse } from "next/server";
import { queryRouteCoordinates, queryRoutesByBusAndDirection } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const busId = parseInt(searchParams.get("busId") || "");
    const direction = parseInt(searchParams.get("direction") || "1");

    if (isNaN(busId)) {
      return NextResponse.json(
        { error: "busId query parameter is required" },
        { status: 400 }
      );
    }

    const routeId = await queryRoutesByBusAndDirection(busId, direction);
    if (!routeId) {
      return NextResponse.json(
        { error: "Route not found" },
        { status: 404 }
      );
    }

    const coordinates = await queryRouteCoordinates(routeId);

    return NextResponse.json({ routeId, coordinates });
  } catch (error) {
    console.error("Failed to fetch route geometry:", error);
    return NextResponse.json(
      { error: "Failed to fetch route geometry" },
      { status: 500 }
    );
  }
}
