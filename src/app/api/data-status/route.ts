import { NextResponse } from "next/server";
import { getDataLastUpdated } from "@/lib/db";

export async function GET() {
  try {
    const lastUpdated = await getDataLastUpdated();
    return NextResponse.json({ lastUpdated });
  } catch {
    return NextResponse.json({ lastUpdated: null });
  }
}
