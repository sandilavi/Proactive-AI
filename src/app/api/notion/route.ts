import { fetchNotionTasks, createNotionTask, updateNotionTask, deleteNotionTask } from "@/app/actions/notion-actions";
import { NextResponse, NextRequest } from "next/server";

// GET: Get the Tasks
export async function GET() {
  const result = await fetchNotionTasks();
  return NextResponse.json(result);
}

// POST: Create a Task
export async function POST(req: NextRequest) {
  const { title, status, date } = await req.json();
  const result = await createNotionTask(title, status, date);
  return NextResponse.json(result);
}

// PATCH: Update a Task
export async function PATCH(req: NextRequest) {
  const { taskId, status } = await req.json();
  const result = await updateNotionTask(taskId, status);
  return NextResponse.json(result);
}

// DELETE: Delete a Task
export async function DELETE(req: NextRequest) {
  const { taskId } = await req.json();
  const result = await deleteNotionTask(taskId);
  return NextResponse.json(result);
}
