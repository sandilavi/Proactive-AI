"use server";

import { notion, getRawNotionTasks } from "@/lib/notion";
import { revalidatePath } from "next/cache";

interface NotionPage {
  id: string;
  properties: {
    'Name': { title: Array<{ plain_text: string }>; };
    'Status': { status: { name: string; }; };
    'Date': { date: { start: string; } | null; };
  };
}

export async function fetchNotionTasks() {
  const rawTasks = (await getRawNotionTasks()) as unknown as NotionPage[];

  const tasks = rawTasks.map((page) => ({
    id: page.id,
    name: page.properties.Name.title[0]?.plain_text || "Untitled Task",
    status: page.properties.Status?.status?.name || "No Status",
    deadline: page.properties['Date']?.date?.start || "No Deadline",
  }));

  // Sort tasks chronologically by deadline.
  // 1. "Done" tasks go to the very bottom.
  // 2. Tasks with "No Deadline" go to the bottom of the active tasks.
  return tasks.sort((a, b) => {
    const aIsDone = a.status.toLowerCase() === "done";
    const bIsDone = b.status.toLowerCase() === "done";

    // "Done" tasks always go to the bottom
    if (aIsDone && !bIsDone) return 1;
    if (!aIsDone && bIsDone) return -1;

    // No deadline goes to the bottom of the current grouping
    if (a.deadline === "No Deadline" && b.deadline !== "No Deadline") return 1;
    if (b.deadline === "No Deadline" && a.deadline !== "No Deadline") return -1;
    if (a.deadline === "No Deadline" && b.deadline === "No Deadline") return 0;

    // Normal chronological sort
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
}

export async function createNotionTask(title: string, statusName: string, date?: string) {
  try {
    const response = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID! },
      properties: {
        'Name': {
          title: [{ text: { content: title } }],
        },
        'Status': {
          status: { name: statusName },
        },
        ...(date && {
          'Date': {
            date: { start: date },
          },
        }),
      },
    });
    revalidatePath("/");
    return { success: true, data: response };
  } catch (error) {
    console.error("Notion Create Error:", error);
    return { success: false, error };
  }
}

export async function updateNotionTask(taskId: string, statusName?: string, date?: string) {
  try {
    const response = await notion.pages.update({
      page_id: taskId,
      properties: {
        ...(statusName && {
          'Status': {
            status: { name: statusName },
          },
        }),
        ...(date && {
          'Date': {
            date: { start: date },
          },
        }),
      },
    });
    revalidatePath("/");
    return { success: true, data: response };
  } catch (error) {
    console.error("Notion Update Error:", error);
    return { success: false, error };
  }
}

export async function deleteNotionTask(taskId: string) {
  try {
    const response = await notion.pages.update({
      page_id: taskId,
      archived: true,
    });
    revalidatePath("/");
    return { success: true, data: response };
  } catch (error) {
    console.error("Notion Archive Error:", error);
    return { success: false, error };
  }
}
