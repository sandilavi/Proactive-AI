"use server";

import { getRawNotionTasks } from "@/lib/notion";

interface NotionPage {
  id: string;
  properties: {
    Name: {
      title: Array<{ plain_text: string }>;
    };
    Status: {
      status: {
        name: string;
      };
    };
    Date: {
      date: {
        end: string;
      };
    };
  };
}

export async function fetchNotionTasks() {
  const rawTasks = (await getRawNotionTasks()) as unknown as NotionPage[];
  
  return rawTasks.map((page) => ({
    id: page.id,
    name: page.properties.Name.title[0]?.plain_text || "Untitled Task",
    status: page.properties.Status?.status?.name || "No Status",
    deadline: page.properties.Date?.date?.end || "No Deadline",
  }));
}
