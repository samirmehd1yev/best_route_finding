import { NextRequest, NextResponse } from "next/server";
import { queryStopDetails } from "@/lib/db";
import { findNearbyStops } from "@/lib/geo";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get("lat") || "");
    const lng = parseFloat(searchParams.get("lng") || "");
    const radius = parseFloat(searchParams.get("radius") || "1.0");
    const limit = parseInt(searchParams.get("limit") || "20");

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: "lat and lng query parameters are required" },
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
