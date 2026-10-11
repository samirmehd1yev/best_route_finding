import { NextRequest, NextResponse } from "next/server";
import { queryRouteCoordinates, queryRoutesByBusAndDirection } from "@/lib/db";
import { isPositiveInteger, numericParam } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const busId = numericParam(searchParams.get("busId"));
    const direction = numericParam(searchParams.get("direction"), 1);

    if (!isPositiveInteger(busId) || (direction !== 1 && direction !== 2)) {
      return NextResponse.json(
        { error: "busId must be a positive integer and direction must be 1 or 2" },
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
