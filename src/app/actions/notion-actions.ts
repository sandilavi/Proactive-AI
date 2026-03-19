"use server";

import { notion, getRawNotionTasks, discoverDatabases, NotionDatabase } from "@/lib/notion";
import { revalidatePath } from "next/cache";

interface NotionPage {
  id: string;
  properties: Record<string, any>;
}

// Re-export discoverDatabases for use in page.tsx
export { discoverDatabases };
export type { NotionDatabase };

// Fetch tasks from a single database using mapped property names
export async function fetchTasksFromDatabase(db: NotionDatabase) {
  const rawTasks = (await getRawNotionTasks(db.id, db.dataSourceId)) as unknown as NotionPage[];

  return rawTasks.map((page) => ({
    id: page.id,
    name: page.properties[db.propNames.title]?.title[0]?.plain_text || "Untitled Task",
    status: page.properties[db.propNames.status]?.status?.name || "No Status",
    deadline: page.properties[db.propNames.date]?.date?.start || "No Deadline",
    databaseId: db.id,
    databaseName: db.name,
    propNames: db.propNames, // Save for CRUD modification
  }));
}

// Fetch tasks from ALL discovered databases (merged + sorted)
export async function fetchNotionTasks(databases?: NotionDatabase[]) {
  const dbs = databases || await discoverDatabases();

  // Fetch tasks from all databases concurrently
  const allTaskArrays = await Promise.all(
    dbs.map(db => fetchTasksFromDatabase(db))
  );

  // Merge all tasks into a single flat array
  const tasks = allTaskArrays.flat();

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

// CREATE a task in a specific database using discovered property names
export async function createNotionTask(title: string, statusName: string, date?: string, databaseId?: string) {
  const dbs = await discoverDatabases();

  // If no databaseId provided, use the first discovered database as default
  const targetDb = databaseId
    ? dbs.find(db => db.id === databaseId)
    : dbs[0];

  if (!targetDb) {
    return { success: false, error: "No Notion database found." };
  }

  try {
    const response = await notion.pages.create({
      parent: { database_id: targetDb.id },
      properties: {
        [targetDb.propNames.title]: {
          title: [{ text: { content: title } }],
        },
        [targetDb.propNames.status]: {
          status: { name: statusName },
        },
        ...(date && {
          [targetDb.propNames.date]: {
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

// UPDATE a task
export async function updateNotionTask(taskId: string, statusName?: string, date?: string, propNames?: { status: string; date: string }) {
  try {
    // If we don't know the prop names, we have to fetch them for this page's database
    let statusProp = propNames?.status || "Status";
    let dateProp = propNames?.date || "Date";

    if (!propNames) {
      // Find database ID first by retrieving the page
      const page: any = await notion.pages.retrieve({ page_id: taskId });
      const dbId = page.parent?.database_id;
      if (dbId) {
        const dbs = await discoverDatabases();
        const db = dbs.find(d => d.id === dbId);
        if (db) {
          statusProp = db.propNames.status;
          dateProp = db.propNames.date;
        }
      }
    }

    const response = await notion.pages.update({
      page_id: taskId,
      properties: {
        ...(statusName && {
          [statusProp]: {
            status: { name: statusName },
          },
        }),
        ...(date && {
          [dateProp]: {
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

// DELETE (archive) a task
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
