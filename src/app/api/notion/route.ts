import { fetchNotionTasks } from "@/app/actions/notion-actions";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const tasks = await fetchNotionTasks();
    return NextResponse.json({ success: true, data: tasks });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to fetch" }, { status: 500 });
  }
}
