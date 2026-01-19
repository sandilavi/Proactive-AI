"use server";

import { fetchNotionTasks as fetchFromLib } from "@/lib/notion";

// Type for Notion page objects with the properties we need
type NotionPage = {
  id: string;
  properties?: {
    Name?: {
      title?: Array<{ plain_text?: string }>;
    };
  };
};

export async function fetchNotionTasks() {
  const rawTasks = await fetchFromLib();
  
  return rawTasks.map((page: NotionPage) => ({
    id: page.id,
    name: page.properties?.Name?.title?.[0]?.plain_text || "Untitled Task",
  }));
}
