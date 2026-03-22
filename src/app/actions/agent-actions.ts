"use server";
import { groq, GROQ_MODEL } from "@/lib/groq";
import { fetchNotionTasks } from "./notion-actions";
import { unstable_cache } from "next/cache";

export interface NotionTask {
  id: string;
  name: string;
  status?: string;
  deadline?: string;
  databaseId?: string;
  databaseName?: string;
  propNames?: { title: string; status: string; date: string };
  propTypes?: { status: "status" | "select" };
}

export interface AgentSuggestion {
  suggestion: string;
  reason: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  confidence: number;
  thinkContext?: string;
}

export type AgentActions = "CREATE" | "READ" | "UPDATE" | "DELETE" | "SUGGEST" | "PLAN" | "UNCLEAR" | "OTHER";
export interface AgentResponse {
  action: AgentActions;
  data: {
    title?: string;
    status?: string;
    date?: string;
    taskId?: string;
    attemptedName?: string;
    targetDatabase?: string; // Database name for CREATE/PLAN routing
    planSummary?: string;
    plan?: Array<{
      title: string;
      date?: string;
      durationHours?: number;
      reason?: string;
    }>;
  };
}

export interface CapacityInsight {
  date: string;
  totalHours: number;
  status: "SAFE" | "BUSY" | "OVERLOADED";
  taskInsights?: Array<{ name: string; estimatedHours: number }>;
  suggestion?: string;
}

export interface CapacityReport {
  insights: CapacityInsight[];
  overallSummary: string;
}


// Helper to extract and parse JSON from LLM response (handles think blocks and markdown)
function extractJSON<T>(raw: string): T | null {
  try {
    // 1. Remove think blocks if they exist (though we handle them separately for context)
    let clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // 2. Try to find the inner JSON block if it's wrapped in markdown
    const codeBlockMatch = clean.match(/```json\n?([\s\S]*?)\n?```/) || clean.match(/```([\s\S]*?)```/);
    if (codeBlockMatch) {
      clean = codeBlockMatch[1].trim();
    }

    // 3. Find the actual JSON object boundaries
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) return null;

    const jsonString = clean.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonString) as T;
  } catch {
    return null;
  }
}


// Centralized priority logic to ensure server-side math is the source of truth
function getUrgencyCategory(hours: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (hours < 24) return "CRITICAL"; // Overdue or due within 24h
  if (hours < 72) return "HIGH";     // 1 to 3 days
  if (hours < 168) return "MEDIUM";  // 3 to 7 days
  return "LOW";                      // More than 7 days
}

// Calculate deadlines and pass it to the getAgentSuggestion function
function calculateDeadlineInfo(deadline: string | undefined | null, localNow: Date, now: Date): { deadlineLabel: string, relativeInfo: string } {
  let deadlineLabel = "No Deadline";
  let relativeInfo = "";

  if (deadline && deadline !== "No Deadline") {
    const isDateOnly = !deadline.includes("T");
    const dlDate = new Date(deadline);

    deadlineLabel = isDateOnly
      ? dlDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: 'UTC' })
      : dlDate.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric" });

    let sortHrs = 0;
    let humanDiff = "";

    if (isDateOnly) {
      const localDateObj = new Date(localNow.toISOString().split("T")[0] + "T00:00:00Z");
      const dlDateObj = new Date(deadline + "T00:00:00Z");
      const diffDays = Math.round((dlDateObj.getTime() - localDateObj.getTime()) / 86400000);
      sortHrs = diffDays * 24;
      humanDiff = diffDays < 0 ? `${Math.abs(diffDays)} days overdue` : diffDays === 0 ? "due today" : `due in ${diffDays} days`;
    } else {
      const diffMs = dlDate.getTime() - now.getTime();
      sortHrs = diffMs / 3600000;
      const absHrs = Math.abs(sortHrs);
      if (sortHrs < 0) {
        humanDiff = absHrs >= 24 ? `${Math.floor(absHrs / 24)}d ${Math.floor(absHrs % 24)}h overdue` : `${Math.floor(absHrs)}h ${Math.floor((absHrs * 60) % 60)}m overdue`;
      } else {
        humanDiff = absHrs >= 24 ? `due in ${Math.floor(absHrs / 24)}d ${Math.floor(absHrs % 24)}h` : `due in ${Math.floor(absHrs)}h ${Math.floor((absHrs * 60) % 60)}m`;
      }
    }

    const urgency = getUrgencyCategory(sortHrs);
    const daysVal = (sortHrs / 24).toFixed(1);
    relativeInfo = ` [Time: ${sortHrs.toFixed(1)}h (~${daysVal} days) | Urgency: ${urgency} | ${humanDiff}]`;
  }

  return { deadlineLabel, relativeInfo };
}


// Calculate user time based on user offset
function getUserLocalTime(userOffset: string) {
  const now = new Date();
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(now.getTime() + offsetMs);

  const today = localNow.toISOString().split("T")[0];
  const currentTime = localNow.toISOString().split("T")[1].split(".")[0];

  return { now, localNow };
}


// Gives which task needs to do for the user based on urgency (For proactive suggestions)
export async function getAgentSuggestion(tasks: NotionTask[], userOffset: string = "+00:00"): Promise<AgentSuggestion | null> {
  const { now, localNow } = getUserLocalTime(userOffset);

  // Only consider active (non-done) tasks
  const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");
  if (activeTasks.length === 0) return null;

  const taskContext = activeTasks
    .map(
      (t: NotionTask) => {
        const { deadlineLabel, relativeInfo } = calculateDeadlineInfo(t.deadline, localNow, now);

        return `- ${t.name} (Status: ${t.status || "N/A"}, Deadline: ${deadlineLabel} | ${relativeInfo})`;
      }
    )
    .join("\n");

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0, // Ensure consistent, deterministic output
    messages: [
      {
        role: "system",
        content: `You are an Expert Executive Assistant. Today is ${localNow.toISOString().split("T")[0]}.
        
        MISSION: Your goal is to help to manage the day by recommending the single most logical next step from the task list.
        
        CORE VALUES:
        - Impact: A professional task > a leisure task > a generic placeholder.
        - Math Check: TRUST the pre-calculated Urgency label and Time stats provided. DO NOT attempt to perform your own math comparisons or range checks.
        - Strict Interpretation: Generic/Dummy tasks (like "abc", "test", "hhh") are the absolute BOTTOM. A real leisure task (like "watch a movie") ALWAYS takes precedence over a dummy placeholder.
        - Communication: Explain your choice casually as if you are a human assistant talking to your boss. DO NOT use technical robotic phrases, logic rules, or mention internal categories. Instead, use conversational reasoning.
        - TIME PHRASING: Use honest relative terms based on the current time (e.g., "due today", "in few days"). NEVER use exact numeric hours/minutes (e.g., "due in 3 hours", "just over 40 minutes"). If a deadline crosses midnight, it is "tomorrow", not "today", regardless of the hour count.
        - NO INTERNAL EXPOSURE: NEVER mention internal terms like "CRITICAL", "HIGH", "Urgency", "Placeholder", etc. Just give a natural human reason why a task is important.
        
        PRIORITY LOGIC (STRICT HIERARCHY):
          1. EVALUATE TASK TYPE (Rule #1): 
             - If task is Generic/Placeholder (e.g. "abc", "test", "hhh") -> Priority is ALWAYS "LOW".
             - If task is Leisure (e.g. "watch movie", "play games") -> Priority is ALWAYS "LOW".
          2. EVALUATE DEADLINE (Rule #2 - ONLY for Professional Tasks):
             - Use the provided Urgency label (CRITICAL, HIGH, MEDIUM, LOW).
             - These labels are pre-calculated based on time to deadline:
               * CRITICAL: Overdue or < 24h.
               * HIGH: 1 to 3 days (24-72h).
               * MEDIUM: 3 to 7 days (72-168h).
               * LOW: 7+ days (168h+).
          
          STRICT RULES:
          - ABSOLUTE PRIORITY: Rule #1 always wins. An overdue leisure task is LOW. A placeholder due in 1 hour is LOW.
          - IMPACT OVERRIDE: If the pre-calculated Urgency is HIGH but the task is a Placeholder, the final Priority MUST be LOW.
        
        CONSTRAINTS:
        - Output MUST be a valid JSON object.
        - 'suggestion': MUST match the exact name of the task from the list.
        - 'reason': Reason MUST contain the task name with at least 2 sentences.
        - 'priority': Use 'CRITICAL', 'HIGH', 'MEDIUM', or 'LOW'.
        - 'confidence': 0-1.
        `,
      },
      { role: "user", content: `Analyze these tasks: \n${taskContext}` },
    ],
  });

  const rawContent = response.choices[0]?.message?.content || "";
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContext = thinkMatch ? thinkMatch[1].trim() : "";

  const result = extractJSON<AgentSuggestion>(rawContent);

  // Validation: ensure we have the critical fields and correct types
  if (!result || !result.suggestion || !result.reason || typeof result.confidence !== "number") {
    throw new Error("AI returned invalid or incomplete suggestion data.");
  }

  // Fallback for priority if LLM misses it
  const priority = (result.priority || "MEDIUM") as any;

  return { ...result, priority, thinkContext };
}


// Analyze user prompt and decides which action needs to take
export async function processUserPrompt(prompt: string, taskContext: string, userOffset: string, databaseNames: string[] = []): Promise<AgentResponse & { thinkContext?: string }> {
  // Timezone adjustment for "Today"
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);
  const today = localNow.toISOString().split("T")[0];

  const dbListStr = databaseNames.length > 0
    ? `\n\nAVAILABLE DATABASES: ${databaseNames.map(n => `"${n}"`).join(", ")}\n- For CREATE/PLAN: pick the most logical database based on the task context. Set "targetDatabase" to the exact database name.\n- For UPDATE/DELETE: the taskId is globally unique, no database routing needed.`
    : "";

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a Notion Task Agent.Today is ${today}.Timezone offset: ${userOffset}.

        EXISTING TASKS:
        ${taskContext}${dbListStr}

        ACTIONS(choose one):
        - CREATE: New task. Extract: title, status (default "To Do"), date (only if user mentions one), targetDatabase.
        - READ: List / view tasks.
        - UPDATE: Modify task properties. Extract: taskId, status, date.
        - DELETE: Remove task. Extract: taskId.
        - SUGGEST: Prioritization advice (e.g. "what is urgent?").
        - PLAN: Perform "Time-Based Capacity Planning" to generate a sequential roadmap of 3 - 6 logical subtasks.
          - 8-HOUR DAILY CAPACITY: Each day has a hard limit of 8 hours of productive work.
          - ESTIMATED COMPLETION TIME (ECT): Estimate hours for EXISTING TASKS based on complexity (e.g. 0.5h for quick tasks, 1-2h for medium sized tasks etc).
          - SEQUENTIAL PACKING: Assign an estimated duration (hours) to each new subtask. Schedule subtasks on days where the total (Existing Tasks + New Subtasks) does not exceed 8 hours. Skip any day at/above capacity.
          - NEVER use a Task ID as a title. Extract: a concise 'planSummary'(1 - 2 sentences) providing a "Time-Based Feasibility Analysis" (e.g., "I scheduled Step 2 on Tuesday because your existing tasks take 3 hours, leaving 5 hours of capacity from your 8-hour daily limit"), targetDatabase, and an array of subtasks with title, date, durationHours, and reason in the 'plan' array.
        - UNCLEAR: UPDATE / DELETE intent but no task confidently matches. Set attemptedName.
        - OTHER: Non task topics.

        DATE RULES:
        - Only include date / time if user explicitly mentions it. Never assume today or midnight.
        - Relative dates ("tomorrow", "next Friday") → calculate from ${today}.
        - Time mentioned → ISO 8601: YYYY - MM - DDTHH: mm:ss${userOffset}. No time → YYYY - MM - DD only.

        MATCHING(UPDATE / DELETE):
        - Match by core keywords, case -insensitive, ignore filler words("a", "the", "an").
        - Only match if exactly ONE task clearly fits.Ambiguous / no match → UNCLEAR.
        - Use exact taskId from the task list.

        OUTPUT(strict JSON):
        {
          "action": "CREATE | READ | UPDATE | DELETE | SUGGEST | PLAN | UNCLEAR | OTHER",
            "data": {
            "taskId": "", "status": "", "title": "", "date": "", "attemptedName": "", "targetDatabase": "",
              "planSummary": "Short feasibility analysis here",
                "plan": [{ "title": "", "date": "", "durationHours": 0, "reason": "" }]
          }
        } `,
      },
      { role: "user", content: prompt },
    ],
  });

  const rawContent = response.choices[0]?.message?.content || "";
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContext = thinkMatch ? thinkMatch[1].trim() : "";

  const parsed = extractJSON<AgentResponse>(rawContent);

  if (!parsed) {
    return { action: "OTHER", data: {}, thinkContext };
  }

  return { ...parsed, thinkContext };
}


// Understand status of the task based on user prompt
function normalizeStatus(input?: string): "Not started" | "In Progress" | "Done" {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "done" || s === "completed") return "Done";
  if (s === "in progress" || s === "ongoing") return "In Progress";
  return "Not started";
}


// Performs notion CRUD based on JSON input
export async function performNotionCRUD(
  action: AgentActions,
  data: AgentResponse["data"],
  aiSuggestion?: AgentSuggestion | null,
  listMessage?: string,
  databases?: Array<{ id: string; name: string }>
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const { createNotionTask, updateNotionTask, deleteNotionTask } = await import("./notion-actions");

  // Resolve targetDatabase name to actual database ID
  const resolveDbId = (targetName?: string): string | undefined => {
    if (!targetName || !databases || databases.length === 0) return databases?.[0]?.id;
    const match = databases.find(db => db.name.toLowerCase() === targetName.toLowerCase());
    return match?.id || databases[0]?.id;
  };

  if (action === "CREATE") {
    const title = (data.title ?? "").trim() || "New Task";
    const status = normalizeStatus(data.status);
    const targetDbId = resolveDbId(data.targetDatabase);
    const result = await createNotionTask(title, status, data.date, targetDbId);
    return {
      success: result.success,
      message: result.success ? "Task created." : "Failed to create task.",
      data: result,
    };
  }

  if (action === "PLAN") {
    if (!data.plan || data.plan.length === 0) {
      return { success: false, message: "No plan provided." };
    }

    const results = [];
    const targetDbId = resolveDbId(data.targetDatabase);
    for (const task of data.plan) {
      const title = (task.title ?? "").trim() || "New Task";
      // Default to not started
      const status = normalizeStatus("Not started");
      results.push(await createNotionTask(title, status, task.date, targetDbId));
    }

    const allSuccess = results.every(r => r.success);
    return {
      success: allSuccess,
      message: allSuccess ? `Successfully created ${results.length} tasks for your plan.` : "Failed to create some tasks in the plan.",
      data: results,
    };
  }

  if (action === "READ") {
    return {
      success: true,
      message: listMessage || "Action completed.",
      data: aiSuggestion
    };
  }

  if (action === "UPDATE") {
    if (!data.taskId)
      return { success: false, message: "Missing taskId for UPDATE." };

    // Resolve propNames for this specific task's database
    let propNames: { status: string; date: string } | undefined;
    let propTypes: { status: "status" | "select" } | undefined;

    // Check if we can find the task in the cache (passed from frontend suggest/read)
    // We try to find the task by ID to get its specific property names
    // This is optional since updateNotionTask has a fallback retrieval
    const { fetchNotionTasks: fetchAll } = await import("./notion-actions");
    const tasks = await fetchAll(databases as any);
    const matchedTask = tasks.find(t => t.id === data.taskId);
    if (matchedTask?.propNames) {
      propNames = matchedTask.propNames;
      propTypes = matchedTask.propTypes;
    }

    // Normalize status if it exists in the data
    const status = data.status ? normalizeStatus(data.status) : undefined;

    // Pass both status and date to the update function
    const result = await updateNotionTask(data.taskId, status, data.date, propNames, propTypes);

    return {
      success: result.success,
      message: result.success ? "Task updated." : "Failed to update task.",
      data: result,
    };
  }

  if (action === "DELETE") {
    if (!data.taskId)
      return { success: false, message: "Missing taskId for DELETE." };
    const result = await deleteNotionTask(data.taskId);
    return {
      success: result.success,
      message: result.success ? "Task deleted." : "Failed to delete task.",
      data: result,
    };
  }

  if (action === "SUGGEST") {
    return {
      success: true,
      message: aiSuggestion?.reason || "Action completed.",
      data: aiSuggestion
    };
  }

  return { success: false, message: `Unsupported action: ${action} ` };
}


// Execute user prompt
export async function executeUserPrompt(prompt: string, userOffset: string = "+00:00") {
  if (!prompt || !prompt.trim()) {
    return {
      success: false,
      message: "Please enter a prompt.",
      actionTaken: null,
      notionResponse: null,
    };
  }

  const { discoverDatabases } = await import("./notion-actions");
  const databases = await discoverDatabases();
  const tasks = await fetchNotionTasks(databases);
  const databaseNames = databases.map(db => db.name);

  // Include database name in task context so the AI knows which DB each task belongs to
  const taskContext = tasks.map(t => `- Name: "${t.name}", ID: "${t.id}", Status: "${t.status || 'No Status'}", Deadline: "${t.deadline || 'No Deadline'}"${t.databaseName ? `, Database: "${t.databaseName}"` : ""}`).join("\n");
  const decision = await processUserPrompt(prompt, taskContext, userOffset, databaseNames);
  const { thinkContext, ...decisionData } = decision;
  const cleanDecision = decisionData as AgentResponse;

  let message = "";
  let aiSuggestion: AgentSuggestion | null = null;
  let finalThinkContext = thinkContext;

  if (cleanDecision.action === "READ") {
    // Table handles the display; only set message when there are no tasks
    if (tasks.length === 0) message = "You have no tasks in your list.";
  }
  else if (cleanDecision.action === "SUGGEST") {
    const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");
    if (activeTasks.length === 0) {
      return {
        success: true,
        message: "You have no active tasks to prioritize. Add some tasks first!",
        actionTaken: cleanDecision,
        tasks,
        thinkContext: finalThinkContext,
      };
    }
    // Run the Logic Engine for prioritization advice
    aiSuggestion = await getAgentSuggestion(tasks, userOffset);
    if (aiSuggestion && aiSuggestion.thinkContext) {
      finalThinkContext = aiSuggestion.thinkContext;
    }
  }
  else if (cleanDecision.action === "UNCLEAR") {
    return {
      success: false,
      message: `I couldn't find a task named "${cleanDecision.data.attemptedName}". Please check the task name in your list and try again!`,
      actionTaken: cleanDecision,
      tasks,
      thinkContext: finalThinkContext,
    };
  }
  else if (cleanDecision.action === "OTHER") {
    return {
      success: true,
      message: "I'm a task assistant, specialized in managing tasks. Ask me something related to managing your tasks.",
      actionTaken: cleanDecision,
      notionResponse: null,
      tasks,
      thinkContext: finalThinkContext,
    };
  }

  // For CRUD mutations, pause and return to UI for human confirmation before touching Notion
  if (cleanDecision.action === "CREATE" || cleanDecision.action === "UPDATE" || cleanDecision.action === "DELETE" || cleanDecision.action === "PLAN") {

    // Guard: no tasks in Notion at all — nothing to delete or update
    if (tasks.length === 0 && (cleanDecision.action === "DELETE" || cleanDecision.action === "UPDATE")) {
      return {
        success: false,
        message: "You have no tasks in your list to modify.",
        actionTaken: cleanDecision,
        tasks,
        thinkContext: finalThinkContext,
      };
    }

    // Guard: LLM returned DELETE/UPDATE but couldn't identify a valid taskId
    if ((cleanDecision.action === "DELETE" || cleanDecision.action === "UPDATE") && !cleanDecision.data.taskId) {
      return {
        success: false,
        message: "I couldn't identify which task to modify. Please check the task name in your list and try again!",
        actionTaken: cleanDecision,
        tasks,
        thinkContext: finalThinkContext,
      };
    }

    let pendingTaskName = cleanDecision.data.title || "";
    if ((cleanDecision.action === "UPDATE" || cleanDecision.action === "DELETE") && cleanDecision.data.taskId) {
      const matchedTask = tasks.find(t => t.id === cleanDecision.data.taskId);
      pendingTaskName = matchedTask?.name || cleanDecision.data.taskId || "";
    } else if (cleanDecision.action === "PLAN") {
      pendingTaskName = `Proposed Plan (${cleanDecision.data.plan?.length || 0} tasks)`;
    }

    // Deadline conflict detection — only for CREATE with a date
    let deadlineConflict = false;
    let conflictingTaskNames: string[] = [];
    if (cleanDecision.action === "CREATE" && cleanDecision.data.date) {
      const newDate = cleanDecision.data.date.split("T")[0]; // date-only comparison
      const conflicts = tasks.filter(t => {
        if (!t.deadline || t.status?.toLowerCase() === "done") return false;
        return t.deadline.split("T")[0] === newDate;
      });
      if (conflicts.length > 0) {
        deadlineConflict = true;
        conflictingTaskNames = conflicts.map(t => t.name);
      }
    }

    // Duplicate task detection — case-insensitive, trimmed name match
    let duplicateTask = false;
    let duplicateTaskName = "";
    if (cleanDecision.action === "CREATE" && cleanDecision.data.title) {
      const newTitle = cleanDecision.data.title.toLowerCase().trim();
      const match = tasks.find(t => t.name.toLowerCase().trim() === newTitle);
      if (match) {
        duplicateTask = true;
        duplicateTaskName = match.name;
      }
    }

    return {
      success: true,
      requiresConfirmation: true as const,
      pendingDecision: cleanDecision,
      pendingTaskName,
      message: "",
      actionTaken: cleanDecision,
      notionResponse: null,
      tasks,
      thinkContext: finalThinkContext,
      deadlineConflict,
      conflictingTaskNames,
      duplicateTask,
      duplicateTaskName,
    };
  }

  // Pass to CRUD (READ/SUGGEST will return success without Notion changes)
  const result = await performNotionCRUD(cleanDecision.action, cleanDecision.data, aiSuggestion, message, databases);

  return {
    success: result.success,
    message: message || result.message,
    actionTaken: cleanDecision,
    notionResponse: result,
    tasks: result.success ? tasks : undefined,
    thinkContext: finalThinkContext,
  };
}


// Execute a confirmed CRUD action — called by the client after user approval
export async function confirmAction(decision: AgentResponse) {
  const { discoverDatabases: discoverDbs } = await import("./notion-actions");
  const databases = await discoverDbs();
  const result = await performNotionCRUD(decision.action, decision.data, null, undefined, databases);
  const returnTasks = result.success ? await fetchNotionTasks(databases) : undefined;
  return {
    success: result.success,
    message: result.message,
    tasks: returnTasks,
  };
}

// Strategic Intelligence: Analyze entire list for capacity overloads
export const getCapacityInsights = unstable_cache(
  async (tasks: NotionTask[], userOffset: string): Promise<CapacityReport> => {
    const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
    const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
    const localNow = new Date(new Date().getTime() + offsetMs);
    const today = localNow.toISOString().split("T")[0];

    const taskContext = tasks
      .filter(t => t.status?.toLowerCase() !== "done")
      .map(t => `- Name: "${t.name}", Status: "${t.status}", Deadline: "${t.deadline}"`)
      .join("\n");

    if (!taskContext) {
      return { insights: [], overallSummary: "Your schedule is clear!" };
    }

    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a Capacity Planning Agent. Today is ${today}. 
          Analyze the task list and provide a Strategic Intelligence Report.
          
          RULES:
          1. Group tasks by date.
          2. Estimate "Completion Hours" for each task based on complexity (0.5h for quick errands, 1-2h for medium sized tasks, 3-5h for deep work).
          3. Thresholds: SAFE (<6h per day), BUSY (6-8h per day), OVERLOADED (>8h per day).
          4. For OVERLOADED days, identify the heaviest task and suggest moving it to a nearby day with capacity.
          
          OUTPUT strict JSON:
          {
            "insights": [
              { "date": "YYYY-MM-DD", "totalHours": 0.0, "status": "SAFE|BUSY|OVERLOADED", "taskInsights": [{ "name": "", "estimatedHours": 0.0 }], "suggestion": "Specific move advice" }
            ],
            "overallSummary": "1-2 sentence overview of the week"
          }`
        },
        { role: "user", content: `Existing Tasks:\n${taskContext}` }
      ]
    });

    const raw = response.choices[0]?.message?.content || "";
    return extractJSON<CapacityReport>(raw) || { insights: [], overallSummary: "Could not generate report." };
  },
  ['strategy-insights'],
  { revalidate: 3600, tags: ['notion-tasks'] }
);

// ---------------------------------------------------------------------------
// Growth Lab: RPG-style Skill Tracking
// ---------------------------------------------------------------------------
export interface SkillInsight {
  skillName: string;
  xp: number; // based on estimated hours
  level: number;
  recentTasks: string[];
}

export interface GrowthReport {
  skills: SkillInsight[];
  topSkill: string;
  summary: string;
}

export const getGrowthInsights = unstable_cache(
  async (tasks: NotionTask[]): Promise<GrowthReport> => {
    const taskContext = tasks
      .map(t => `- Name: "${t.name}", Status: "${t.status}"`)
      .join("\n");

    if (!taskContext) {
      return { skills: [], topSkill: "None", summary: "Your skill tree is waiting to grow! Start adding tasks." };
    }

    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `You are The Growth Lab AI. Analyze the user's tasks and create an RPG-style "Skill Tree".
          
          RULES:
          1. Categorize tasks into broad skills (e.g., "Frontend", "Backend", "Design", "Writing", "Management", "Life/Chores").
          2. Assign XP to each skill based on estimated effort (roughly 1 XP = 1 hour).
          3. Calculate a level for each skill: Level = Math.floor(XP / 10) + 1.
          4. Provide the names of 2-3 recent tasks that contributed to this skill.
          5. Identify the "topSkill" (the one with the most XP).
          6. Write a short, motivating summary celebrating their progress (e.g., "You spent 15 hours on Backend this week. You're becoming a specialist!").
          
          OUTPUT strict JSON:
          {
            "skills": [
              { "skillName": "String", "xp": Number, "level": Number, "recentTasks": ["task1", "task2"] }
            ],
            "topSkill": "String",
            "summary": "String"
          }`
        },
        { role: "user", content: `Existing Tasks:\n${taskContext}` }
      ]
    });

    const raw = response.choices[0]?.message?.content || "";
    return extractJSON<GrowthReport>(raw) || { skills: [], topSkill: "None", summary: "Could not generate growth report." };
  },
  ['growth-insights'],
  { revalidate: 3600, tags: ['notion-tasks'] }
);

// ---------------------------------------------------------------------------
// Productivity Pulse: Predictive Analytics
// ---------------------------------------------------------------------------
export interface PulseTrend {
  trendName: string;
  metric: string;
  description: string;
  isPositive: boolean;
}

export interface PulseReport {
  overallScore: number; // 0-100
  summary: string;
  trends: PulseTrend[];
  recommendation: string;
}

export const getPulseInsights = unstable_cache(
  async (tasks: NotionTask[]): Promise<PulseReport> => {
    const taskContext = tasks
      .map(t => `- Name: "${t.name}", Status: "${t.status}", Deadline: "${t.deadline}"`)
      .join("\n");

    if (!taskContext) {
      return { overallScore: 0, summary: "No data available yet.", trends: [], recommendation: "Add tasks to see your pulse." };
    }

    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `You are The Productivity Pulse AI. Analyze the user's task list (status, deadlines) and generate predictive analytics.
          
          RULES:
          1. Calculate a realistic 'overallScore' (0-100) representing their workflow health (e.g., lots of overdue = lower score).
          2. Identify 3-4 distinct 'trends' in their habits (e.g., "Overestimating Fridays", "Strong finish rate", "Heavy backlog").
          3. Determine if each trend isPositive (boolean).
          4. Give a strong, actionable recommendation for the upcoming days.
          
          OUTPUT strict JSON:
          {
            "overallScore": Number,
            "summary": "String",
            "trends": [
              { "trendName": "String", "metric": "String (e.g. '+20%')", "description": "String", "isPositive": Boolean }
            ],
            "recommendation": "String"
          }`
        },
        { role: "user", content: `Tasks:\n${taskContext}` }
      ]
    });

    const raw = response.choices[0]?.message?.content || "";
    return extractJSON<PulseReport>(raw) || { overallScore: 50, summary: "Analysis failed.", trends: [], recommendation: "" };
  },
  ['pulse-insights'],
  { revalidate: 3600, tags: ['notion-tasks'] }
);

// ---------------------------------------------------------------------------
// Focus Horizon: Automatic Project Breakdown
// ---------------------------------------------------------------------------
export interface HorizonTaskEntry {
  dayOffset: number; // Day 1, Day 2, etc.
  title: string;
  estimatedHours: number;
  description: string;
}

export interface HorizonRoadmap {
  projectTitle: string;
  summary: string;
  tasks: HorizonTaskEntry[];
}

export async function generateHorizonRoadmap(goalPrompt: string): Promise<HorizonRoadmap> {
  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are the Focus Horizon AI. The user will provide a high-level project goal. Your job is to break it down into a highly actionable, logical 14-day roadmap.
        
        RULES:
        1. Break the goal into sequential daily tasks.
        2. Assign a 'dayOffset' (1 to 14) for each task. You don't have to fill all 14 days if the project is small.
        3. Estimate hours per task (keep it under 4h per day).
        4. Provide clear descriptions.
        
        OUTPUT strict JSON:
        {
          "projectTitle": "String",
          "summary": "String",
          "tasks": [
            { "dayOffset": Number, "title": "String", "estimatedHours": Number, "description": "String" }
          ]
        }`
      },
      { role: "user", content: `Project Goal:\n${goalPrompt}` }
    ]
  });

  const raw = response.choices[0]?.message?.content || "";
  return extractJSON<HorizonRoadmap>(raw) || { projectTitle: "Generation Failed", summary: "Please try again.", tasks: [] };
}

