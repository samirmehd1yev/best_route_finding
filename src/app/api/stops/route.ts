import { NextRequest, NextResponse } from "next/server";
import { queryStopDetails } from "@/lib/db";

const MAX_PAGE_SIZE = 5000;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const all = await queryStopDetails();

    // Backwards-compatible: with no params, return everything (the UI loads
    // the full list once on boot).  Pagination is opt-in for callers that
    // don't want the whole 3.4k payload.
    if (limitParam === null && offsetParam === null) {
      return NextResponse.json({ stops: all, total: all.length });
    }

    const offset = Math.max(0, parseInt(offsetParam || "0", 10) || 0);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(limitParam || "100", 10) || 100)
    );
    return NextResponse.json({
      stops: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch stops:", error);
    return NextResponse.json(
      { error: "Failed to fetch stops" },
      { status: 500 }
    );
  }
}
