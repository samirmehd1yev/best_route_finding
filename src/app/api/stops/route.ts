import { NextResponse } from "next/server";
import { queryStopDetails } from "@/lib/db";

export async function GET() {
  try {
    const stops = await queryStopDetails();
    return NextResponse.json({ stops });
  } catch (error) {
    console.error("Failed to fetch stops:", error);
    return NextResponse.json(
      { error: "Failed to fetch stops" },
      { status: 500 }
    );
  }
}
