"use server";
import { groq, getGroqModel } from "@/lib/groq";
import { NotionTask } from "./assistant-actions";
import { extractJSON } from "@/lib/utils";
import { getCapacityInsights } from "./strategy-actions";

export interface HorizonTaskEntry {
  date: string;
  title: string;
  durationHours: number;
  reason: string;
}

export interface HorizonRoadmap {
  projectTitle: string;
  summary: string;
  tasks: HorizonTaskEntry[];
  thinkContext?: string;
}

export async function generateHorizonRoadmap(goalPrompt: string): Promise<HorizonRoadmap> {
  const { fetchNotionTasks } = await import("./notion-actions");
  const freshTasks = await fetchNotionTasks();

  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
  const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
  const userOffset = `${sign}${hours}:${minutes}`;

  const capacityReport = await getCapacityInsights(freshTasks, userOffset);
  const capacityContext = capacityReport.insights
    .map(i => `- ${i.date}: Current load is ${i.totalHours.toFixed(1)}h (${i.status})`)
    .join("\n");

  const today = now.toISOString().split("T")[0];
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });

  const response = await groq.chat.completions.create({
    model: await getGroqModel(),
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are the Focus Horizon AI. The user will provide a high-level project goal.
        Today is ${dayName}, ${today}.
        
        YOUR MISSION: Architect a project roadmap that fits the user's REAL-WORLD capacity.
        
        USER'S CURRENT WORKLOAD (FROM OTHER PROJECTS):
        ${capacityContext}
        
        PLANNING RULES:
        1. STRATEGIC SEQUENCING: Prioritize your REAL-WORLD availability. Look at the CURRENT WORKLOAD above before assigning tasks.
        2. SMART AVOIDANCE: If a date is labeled "BUSY" (meaning it has >= 10 hours of work), DO NOT schedule new tasks on that day. Skip it and find the next available day with < 7 hours of existing work to ensure you don't instantly make it "BUSY".
        3. HARD CAP: Ensure the NEW roadmap tasks + EXISTING workload never exceed 10 hours total for any single day.
        4. ROADMAP STRUCTURE: Generate 4 - 8 subtasks that logically complete the goal.
        
        OUTPUT strict JSON schema:
        {
          "projectTitle": "String",
          "summary": "String",
          "tasks": [
            { "date": "YYYY-MM-DD", "title": "String", "durationHours": Number, "reason": "Reason referencing the capacity availability" }
          ]
        }
        `
      },
      { role: "user", content: goalPrompt }
    ]
  });

  const raw = response.choices[0]?.message?.content || "";
  const data = extractJSON<HorizonRoadmap>(raw);
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContext = thinkMatch ? thinkMatch[1].trim() : (data as any)?.thinkContext || "";

  const finalData = data || { projectTitle: "Generation Failed", summary: "Please try again.", tasks: [] };
  return { ...finalData, thinkContext };
}
