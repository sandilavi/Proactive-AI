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
  targetDbId?: string;
  tasks: HorizonTaskEntry[];
  thinkContext?: string;
}

export async function generateHorizonRoadmap(goalPrompt: string, userOffset: string): Promise<HorizonRoadmap> {
  const { fetchNotionTasks, discoverDatabases } = await import("./notion-actions");
  const freshTasks = await fetchNotionTasks();
  const dbs = await discoverDatabases();
  const dbContext = dbs.map(db => `- "${db.name}" (ID: ${db.id})`).join("\n");

  const now = new Date();
  
  // Use the userOffset passed from the client instead of the server's timezone
  const [offsetSign, offsetH, offsetM] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(offsetH) * 60 + parseInt(offsetM)) * 60000 * (offsetSign === "+" ? 1 : -1);
  const localNow = new Date(now.getTime() + offsetMs);

  const capacityReport = await getCapacityInsights(freshTasks, userOffset);
  const capacityContext = capacityReport.insights
    .map(i => `- ${i.date}: Current load is ${i.totalHours.toFixed(1)}h (${i.status})`)
    .join("\n");

  const today = localNow.toISOString().split("T")[0];
  const dayName = localNow.toLocaleDateString('en-US', { weekday: 'long' });
  const localTime = localNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const currentHour = localNow.getHours();
  const realisticRemainingHours = Math.max(0, 22 - currentHour); // Assume workday ends at 10 PM

  const response = await groq.chat.completions.create({
    model: await getGroqModel(),
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are the Focus Horizon AI. The user will provide a high-level project goal.
        Today is ${dayName}, ${today}. The current local time is ${localTime}.
        
        YOUR MISSION: Architect a project roadmap that fits the user's REAL-WORLD capacity.
        
        USER'S CURRENT WORKLOAD (FROM OTHER PROJECTS):
        ${capacityContext}

        AVAILABLE DATABASES:
        ${dbContext}
        
        PLANNING RULES:
        1. STRATEGIC SEQUENCING: Prioritize your REAL-WORLD availability. Look at the CURRENT WORKLOAD above before assigning tasks.
        2. SMART AVOIDANCE: If a date is labeled "BUSY" (meaning it has >= 10 hours of work), DO NOT schedule new tasks on that day. Skip it and find the next available day with < 8 hours of existing work to ensure you don't instantly make it "BUSY".
        3. HARD CAP: Ensure the NEW roadmap tasks + EXISTING workload never exceed 10 hours total for any single day. (Note: "BUSY" means it has >= 10 hours of work)
        4. TODAY'S TIME LIMIT: It is currently ${localTime}. You realistically only have about ${realisticRemainingHours} working hours left today. DO NOT assign more than ${realisticRemainingHours} hours of tasks to Today (${today}), regardless of how empty the schedule looks!
        5. ROADMAP STRUCTURE: Generate 4 - 8 subtasks that logically complete the goal.
        6. TARGET DATABASE: Pick the most logical database from AVAILABLE DATABASES to store this project, or omit if none match perfectly.
        
        OUTPUT strict JSON schema:
        {
          "projectTitle": "String",
          "summary": "String",
          "targetDbId": "String (Database ID) or omitted",
          "tasks": [
            { "date": "YYYY-MM-DD", "title": "String", "durationHours": Number, "reason": "Reason referencing the capacity availability" }
          ]
        }
        `
      },
      { role: "user", content: goalPrompt }
    ]
  });

  const msg = response.choices[0]?.message;
  const raw = msg?.content || "";
  const data = extractJSON<HorizonRoadmap>(raw);
  const reasoning = (msg as any)?.reasoning || (msg as any)?.reasoning_content || "";
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContext = thinkMatch ? thinkMatch[1].trim() : (reasoning ? reasoning.trim() : ((data as any)?.thinkContext || ""));

  const finalData = data || { projectTitle: "Generation Failed", summary: "Please try again.", tasks: [] };
  return { ...finalData, thinkContext };
}
