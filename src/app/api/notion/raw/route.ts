import { getRawNotionTasks } from "@/lib/notion";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const tasks = await getRawNotionTasks();
    return NextResponse.json({ success: true, data: tasks });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to fetch" }, { status: 500 });
  }
}
