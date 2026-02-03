"use server";

import { notion, getRawNotionTasks } from "@/lib/notion";

interface NotionPage {
  id: string;
  properties: {
    'Name': { title: Array<{ plain_text: string }>; };
    'Status': { status: { name: string; }; };
    'Due Date': { date: { start: string; } | null; };
  };
}

export async function fetchNotionTasks() {
  const rawTasks = (await getRawNotionTasks()) as unknown as NotionPage[];
  
  return rawTasks.map((page) => ({
    id: page.id,
    name: page.properties.Name.title[0]?.plain_text || "Untitled Task",
    status: page.properties.Status?.status?.name || "No Status",
    deadline: page.properties['Due Date']?.date?.start || "No Deadline",
  }));
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
          'Due Date': {
            date: { start: date },
          },
        }),
      },
    });
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
          'Due Date': {
            date: { start: date },
          },
        }),
      },
    });
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
    return { success: true, data: response };
  } catch (error) {
    console.error("Notion Archive Error:", error);
    return { success: false, error };
  }
}
