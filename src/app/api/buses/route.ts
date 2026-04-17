import { NextResponse } from "next/server";
import { queryBuses } from "@/lib/db";

export async function GET() {
  try {
    const buses = await queryBuses();
    return NextResponse.json({ buses });
  } catch (error) {
    console.error("Failed to fetch buses:", error);
    return NextResponse.json(
      { error: "Failed to fetch buses" },
      { status: 500 }
    );
  }
}
