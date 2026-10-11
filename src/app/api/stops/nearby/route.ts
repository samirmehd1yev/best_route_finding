import { NextRequest, NextResponse } from "next/server";
import { queryStopDetails } from "@/lib/db";
import { findNearbyStops, isValidCoordinate } from "@/lib/geo";
import { isPositiveInteger, numericParam } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = numericParam(searchParams.get("lat"));
    const lng = numericParam(searchParams.get("lng"));
    const radius = numericParam(searchParams.get("radius"), 1);
    const limit = numericParam(searchParams.get("limit"), 20);

    if (!isValidCoordinate({ latitude: lat, longitude: lng })) {
      return NextResponse.json(
        { error: "lat must be between -90 and 90 and lng between -180 and 180" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(radius) || radius < 0 || !isPositiveInteger(limit)) {
      return NextResponse.json(
        { error: "radius must be finite and non-negative; limit must be a positive integer" },
        { status: 400 }
      );
    }

    const stops = await queryStopDetails();
    const nearby = findNearbyStops(lat, lng, stops, radius, limit);

    return NextResponse.json({ stops: nearby });
  } catch (error) {
    console.error("Failed to fetch nearby stops:", error);
    return NextResponse.json(
      { error: "Failed to fetch nearby stops" },
      { status: 500 }
    );
  }
}
