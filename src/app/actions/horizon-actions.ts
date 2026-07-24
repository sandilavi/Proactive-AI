"use server";
import { groq, getGroqModel } from "@/lib/groq";
import { NotionTask } from "./assistant-actions";
import { extractJSON } from "@/lib/utils";
import { getCapacityInsights } from "./strategy-actions";

export interface HorizonTaskEntry {
  date: string;
  title: string;
  durationHours: number;
  description: string;
  reason?: string;
}

export interface HorizonRoadmap {
  projectTitle: string;
  summary: string;
  targetDbId?: string;
  tasks: HorizonTaskEntry[];
  thinkContext?: string;
}

export async function generateHorizonRoadmap(
  goalPrompt: string, 
  userOffset: string,
  persistentMemory?: Record<string, number>
): Promise<HorizonRoadmap> {
  const { fetchNotionTasks, discoverDatabases } = await import("./notion-actions");
  const freshTasks = await fetchNotionTasks();
  const dbs = await discoverDatabases();
  const dbContext = dbs.map(db => `- "${db.name}" (ID: ${db.id})`).join("\n");

  const now = new Date();
  
  // Use the userOffset passed from the client instead of the server's timezone
  const [offsetSign, offsetH, offsetM] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(offsetH) * 60 + parseInt(offsetM)) * 60000 * (offsetSign === "+" ? 1 : -1);
  const localNow = new Date(now.getTime() + offsetMs);

  const currentHour = localNow.getHours();
  const realisticRemainingHours = Math.max(0, 22 - currentHour); // Assume workday ends at 10 PM

  const capacityReport = await getCapacityInsights(freshTasks, userOffset, persistentMemory);

  // Pre-calculate remaining capacity per day for the next 7 days (based on 9.5h max daily workload target)
  const capacityMap = new Map<string, number>();
  capacityReport.insights.forEach(i => {
    capacityMap.set(i.date, i.totalHours);
  });

  const capacityScheduleLines: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(localNow.getTime() + i * 86400000);
    const dateStr = d.toISOString().split("T")[0];
    const dayLabel = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString('en-US', { weekday: 'long' });
    const currentLoad = capacityMap.get(dateStr) || 0;
    
    // Standard days targeted at 9.5h max total workload to guarantee staying strictly under 10h BUSY overload
    const maxDayCap = i === 0 ? Math.min(9.5, realisticRemainingHours) : 9.5;
    
    // For Today (i === 0), NEVER schedule new tasks if existing load is >= 9.0h.
    // For future days, do not schedule if existing load is >= 9.5h.
    let remainingCap = 0;
    const maxAllowedExistingLoad = i === 0 ? 9.0 : 9.5;

    if (currentLoad < maxAllowedExistingLoad) {
      const rawCap = Math.max(0, maxDayCap - currentLoad);
      remainingCap = Math.floor(rawCap * 2) / 2;
      if (remainingCap < 1.0) remainingCap = 0;
    }

    if (remainingCap <= 0) {
      capacityScheduleLines.push(`- ${dateStr} (${dayLabel}): Existing Workload = ${currentLoad.toFixed(1)}h | REMAINING CAPACITY = 0.0h (FULL - DO NOT SCHEDULE ANY NEW TASKS HERE)`);
    } else {
      capacityScheduleLines.push(`- ${dateStr} (${dayLabel}): Existing Workload = ${currentLoad.toFixed(1)}h | REMAINING CAPACITY = ${remainingCap.toFixed(1)}h (Max allowed new task duration on this date: ${remainingCap.toFixed(1)}h)`);
    }
  }

  const capacityContext = capacityScheduleLines.join("\n");

  const today = localNow.toISOString().split("T")[0];
  const dayName = localNow.toLocaleDateString('en-US', { weekday: 'long' });
  const localTime = localNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const response = await groq.chat.completions.create({
    model: await getGroqModel(),
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are the Focus Horizon AI. The user will provide a high-level project goal.
        Today is ${dayName}, ${today}. The current local time is ${localTime}.
        
        YOUR MISSION: Architect a project roadmap that fits the user's REAL-WORLD capacity without overloading any day.
        
        USER'S DAILY CAPACITY & WORKLOAD SCHEDULE:
        ${capacityContext}

        AVAILABLE DATABASES:
        ${dbContext}
        
        STRICT PLANNING RULES:
        1. RESPECT REMAINING CAPACITY: For each date, the sum of your new task durations MUST NOT exceed the "REMAINING CAPACITY" listed above.
        2. ZERO CAPACITY DATES: If a date says "REMAINING CAPACITY = 0.0h (FULL)", DO NOT schedule any tasks on that date! Move to the next available date.
        3. HARD CAP (9.5 HOURS MAXIMUM): Ensure total daily workload (Existing Workload + New Tasks) NEVER exceeds 9.5 hours. Keep total load strictly <= 9.5 hours per day to prevent triggering BUSY overload alerts.
        4. 0.5-HOUR DURATION GRANULARITY: Every task's durationHours MUST be a strict multiple of 0.5 (e.g., 0.5, 1.0, 1.5, 2.0, 2.5, 3.0). DO NOT output arbitrary decimals like 0.4, 0.7, 2.4, etc.
        5. HELPFUL TASK DESCRIPTIONS: For each task, provide a clear 1 sentence "description" explaining what work this task involves and what deliverables are expected. Do NOT write capacity budget notes!
        6. ROADMAP STRUCTURE: Generate 4 - 8 logical subtasks to achieve the user's goal over the upcoming days.
        7. TARGET DATABASE: Pick the most logical database from AVAILABLE DATABASES to store this project, or omit if none match.
        
        OUTPUT strict JSON schema:
        {
          "projectTitle": "String",
          "summary": "String",
          "targetDbId": "String (Database ID) or omitted",
          "tasks": [
            { 
              "date": "YYYY-MM-DD", 
              "title": "Task Title", 
              "durationHours": Number, 
              "description": "Clear 1 sentence description explaining what this specific subtask involves." 
            }
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
  
  // Post-processing Sanitizer: Guarantee all task durations are strict 0.5h multiples
  if (finalData.tasks && Array.isArray(finalData.tasks)) {
    finalData.tasks.forEach(t => {
      const rawDuration = typeof t.durationHours === 'number' && t.durationHours > 0 ? t.durationHours : 1.0;
      t.durationHours = Math.max(0.5, Math.round(rawDuration * 2) / 2);
    });
  }

  return { ...finalData, thinkContext };
}
