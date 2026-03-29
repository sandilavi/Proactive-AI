"use server";

import { notion, getRawNotionTasks, discoverDatabases as rawDiscoverDatabases, NotionDatabase } from "@/lib/notion";
import { revalidatePath, unstable_cache } from "next/cache";

interface NotionPage {
  id: string;
  properties: Record<string, any>;
}

// 1. Discover databases in real-time
// Removing unstable_cache for zero-refresh development experience
export async function discoverDatabases(): Promise<NotionDatabase[]> {
  return rawDiscoverDatabases();
}

export type { NotionDatabase };

// Fetch tasks from a single database using mapped property names
export async function fetchTasksFromDatabase(db: NotionDatabase) {
  const rawTasks = (await getRawNotionTasks(db.id, db.dataSourceId)) as unknown as NotionPage[];

  return rawTasks.map((page) => {
    const statusProp = page.properties[db.propNames.status];
    const statusValue = db.propTypes.status === "status"
      ? statusProp?.status?.name
      : statusProp?.select?.name;

    return {
      id: page.id,
      name: page.properties[db.propNames.title]?.title[0]?.plain_text || "Untitled Task",
      status: statusValue || "No Status",
      deadline: page.properties[db.propNames.date]?.date?.start || "No Deadline",
      databaseId: db.id,
      databaseName: db.name,
      propNames: db.propNames, // Save for CRUD modification
      propTypes: db.propTypes,
    };
  });
}

import { cache } from "react";

// Fetch fresh Notion tasks on every request
// Persistence: Use React.cache instead of unstable_cache for fresh data parity.
// This ensures deduplication if multiple components call it during one lifecycle.
export const fetchNotionTasks = cache(
  async (databases?: NotionDatabase[]) => {
    const dbs = databases || await discoverDatabases();

    const allTaskArrays = await Promise.all(
      dbs.map(async db => {
        try {
          return await fetchTasksFromDatabase(db);
        } catch (e: any) {
          console.error(`Notion Fetch Error for "${db.name}":`, e);

          // NEW: Nuclear Cache Buster
          // If the DB was deleted in Notion, we MUST invalidate the discovery cache
          if (e?.status === 404 || e?.message?.includes('Could not find database')) {
            revalidatePath('/', 'layout');
          }

          return []; // Fail gracefully for this specific DB
        }
      })
    );

    const tasks = allTaskArrays.flat();

    return tasks.sort((a, b) => {
      const aIsDone = a.status.toLowerCase() === "done";
      const bIsDone = b.status.toLowerCase() === "done";

      if (aIsDone && !bIsDone) return 1;
      if (!aIsDone && bIsDone) return -1;

      if (a.deadline === "No Deadline" && b.deadline !== "No Deadline") return 1;
      if (b.deadline === "No Deadline" && a.deadline !== "No Deadline") return -1;
      if (a.deadline === "No Deadline" && b.deadline === "No Deadline") return 0;

      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
  }
);

// CREATE a task
export async function createNotionTask(title: string, statusName: string, date?: string, databaseId?: string) {
  const dbs = await discoverDatabases();
  const targetDb = databaseId ? dbs.find(db => db.id === databaseId) : dbs[0];

  if (!targetDb) return { success: false, error: "No Notion database found." };

  try {
    const parent = targetDb.dataSourceId
      ? { data_source_id: targetDb.dataSourceId }
      : { database_id: targetDb.id };

    const response = await notion.pages.create({
      parent: parent as any,
      properties: {
        [targetDb.propNames.title]: { title: [{ text: { content: title } }] },
        [targetDb.propNames.status]: { [targetDb.propTypes.status]: { name: statusName } } as any,
        ...(date && { [targetDb.propNames.date]: { date: { start: date } } }),
      },
    });

    // Invalidate everything to ensure fresh data after mutation
    revalidatePath("/dashboard", "page");
    revalidatePath("/", "layout");

    return { success: true, data: response };
  } catch (error: any) {
    const errorMessage = error?.body ? JSON.parse(error.body).message : error.message || "Unknown error";
    return { success: false, error: errorMessage };
  }
}

// UPDATE a task
export async function updateNotionTask(taskId: string, statusName?: string, date?: string, propNames?: { status: string; date: string }, propTypes?: { status: "status" | "select" }) {
  try {
    let statusProp = propNames?.status || "Status";
    let dateProp = propNames?.date || "Date";
    let statusType: "status" | "select" = propTypes?.status || "status";

    if (!propNames || !propTypes) {
      const page: any = await notion.pages.retrieve({ page_id: taskId });
      const dbId = page.parent?.database_id;
      if (dbId) {
        const dbs = await discoverDatabases();
        const db = dbs.find(d => d.id === dbId);
        if (db) {
          statusProp = db.propNames.status;
          dateProp = db.propNames.date;
          statusType = db.propTypes.status;
        }
      }
    }

    const response = await notion.pages.update({
      page_id: taskId,
      properties: {
        ...(statusName && { [statusProp]: { [statusType]: { name: statusName } } as any }),
        ...(date && { [dateProp]: { date: { start: date } } }),
      },
    });

    revalidatePath("/dashboard", "page");
    revalidatePath("/", "layout");

    return { success: true, data: response };
  } catch (error) {
    return { success: false, error };
  }
}

// DELETE a task
export async function deleteNotionTask(taskId: string) {
  try {
    const response = await notion.pages.update({
      page_id: taskId,
      archived: true,
    });

    revalidatePath("/dashboard", "page");
    revalidatePath("/", "layout");

    return { success: true, data: response };
  } catch (error) {
    return { success: false, error };
  }
}

// BATCH CREATE tasks from Horizon
export async function batchCreateNotionTasks(tasks: { title: string; date: string }[]) {
  const dbs = await discoverDatabases();
  const targetDb = dbs[0];

  if (!targetDb) return { success: false, error: "No Notion database found." };

  try {
    const results = await Promise.all(
      tasks.map(task => {
        const parent = targetDb.dataSourceId
          ? { data_source_id: targetDb.dataSourceId }
          : { database_id: targetDb.id };

        return notion.pages.create({
          parent: parent as any,
          properties: {
            [targetDb.propNames.title]: { title: [{ text: { content: task.title } }] },
            [targetDb.propNames.status]: { [targetDb.propTypes.status]: { name: "Not Started" } } as any,
            [targetDb.propNames.date]: { date: { start: task.date } },
          },
        });
      })
    );

    revalidatePath("/dashboard", "page");
    revalidatePath("/", "layout");

    return { success: true, count: results.length };
  } catch (error: any) {
    const errorMessage = error?.body ? JSON.parse(error.body).message : error.message || "Unknown error during batch export";
    return { success: false, error: errorMessage };
  }
}
