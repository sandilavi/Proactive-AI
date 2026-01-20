import { getRawNotionTasks } from "@/lib/notion";

export async function GET() {
  const tasks = await getRawNotionTasks();
  return Response.json(tasks);
}
