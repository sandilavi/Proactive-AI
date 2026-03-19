import { getRawNotionTasks, discoverDatabases } from "@/lib/notion";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const dbs = await discoverDatabases();
    const allRawResults = await Promise.all(
      dbs.map(db => getRawNotionTasks(db.id, db.dataSourceId))
    );
    return NextResponse.json({ success: true, data: allRawResults.flat() });
  } catch (error) {
    console.error("Raw Fetch Error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch tasks" }, { status: 500 });
  }
}
