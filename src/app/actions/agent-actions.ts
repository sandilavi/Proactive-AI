"use server";
import { groq, GROQ_MODEL } from "@/lib/groq";
import { fetchNotionTasks } from "./notion-actions";

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
  updatedAt?: number;
  deadline?: string;
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
  taskInsights?: Array<{ id: string; name: string; estimatedHours: number }>;
  suggestion?: string;
  reason?: string;
  // Structured fields for the Accept/Reject action buttons
  mitigationTaskName?: string;   // The exact task name to move
  mitigationTargetDate?: string; // ISO date string "YYYY-MM-DD" to move it to
}

export interface CapacityReport {
  insights: CapacityInsight[];
  overallSummary: string;
  thinkContext?: string;
  knownEstimations?: Record<string, number>;
}

// Utility: Validates and parses JSON from the AI (strips reasoning blocks and markdown).
function extractJSON<T>(raw: string): T | null {
  try {
    // Layer 1: Strip closed <think> blocks
    let clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Layer 2: Handle UNCLOSED <think> tags (truncated response) 
    // If <think> exists but no </think>, strip from <think> to end
    if (clean.includes('<think>')) {
      clean = clean.replace(/<think>[\s\S]*/g, "").trim();
    }

    // Layer 3: Also try extracting JSON from the RAW string directly
    // (in case the entire response is just the think block + JSON after it)
    const rawJsonMatch = raw.match(/\{[\s\S]*"insights"[\s\S]*\}/);
    const candidates = [clean, rawJsonMatch?.[0] || ""].filter(Boolean);

    for (const candidate of candidates) {
      let c = candidate.replace(/```json/gi, "").replace(/```/g, "").trim();
      // Layer 4: Deep Scan - Regex for the boundaries of the FIRST object that looks like our data
      const deepMatch = c.match(/\{\s*"insights"[\s\S]*\}/);
      if (deepMatch) {
        let dm = deepMatch[0].replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(dm) as T; } catch (e) { }
      }

      // Layer 5: Bracket Hunter - Scan for valid JSON object boundaries
      c = c.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(c) as T; } catch (e) { }

      const firstCurly = c.indexOf('{');
      const lastCurly = c.lastIndexOf('}');
      if (firstCurly !== -1 && lastCurly !== -1 && lastCurly > firstCurly) {
        const slice = c.substring(firstCurly, lastCurly + 1);
        try { return JSON.parse(slice) as T; } catch (e) { }
      }
    }

    return null;
  } catch (e) {
    console.error("Agent JSON Parsing Failed:", String(e));
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

// Understand status of the task based on user prompt
function normalizeStatus(input?: string): "Not started" | "In Progress" | "Done" {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "done" || s === "completed") return "Done";
  if (s === "in progress" || s === "ongoing") return "In Progress";
  return "Not started";
}


// Analyze user prompt and decides which action needs to take
export async function processUserPrompt(prompt: string, taskContext: string, userOffset: string, databaseNames: string[] = []): Promise<AgentResponse & { thinkContext?: string }> {
  // Timezone adjustment for "Today"
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);
  const today = localNow.toISOString().split("T")[0];

  const dbListStr = databaseNames.length > 0
    ? `\n\nAVAILABLE DATABASES: ${databaseNames.map(n => `"${n}"`).join(", ")}\n- For CREATE: pick the most logical database based on the task context. Set "targetDatabase" to the exact database name.\n- For UPDATE/DELETE: the taskId is globally unique, no database routing needed.`
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
        - SUGGEST: Prioritization advice (e.g. "what is urgent?", "what should I focus on?").
        - UNCLEAR: UPDATE / DELETE intent but no task confidently matches. Set attemptedName.
        - OTHER: Non task topics. If the user asks to plan, build a roadmap, or schedule steps for a goal, return OTHER.

        DATE RULES:
        - Only include date / time if user explicitly mentions it. Never assume today or midnight.
        - Relative dates ("tomorrow", "next Friday") → calculate from ${today}.
        - Time mentioned → ISO 8601: YYYY - MM - DDTHH: mm:ss${userOffset}. No time → YYYY - MM - DD only.

        MATCHING(UPDATE / DELETE):
        - Match by core keywords, case -insensitive, ignore filler words("a", "the", "an").
        - Only match if exactly ONE task clearly fits. Ambiguous / no match → UNCLEAR.
        - Use exact taskId from the task list.

        OUTPUT(strict JSON):
        {
          "action": "CREATE | READ | UPDATE | DELETE | SUGGEST | UNCLEAR | OTHER",
          "data": {
            "taskId": "", "status": "", "title": "", "date": "", "attemptedName": "", "targetDatabase": ""
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
  const finalThinkContext = thinkContext || (parsed as any)?.thinkContext || "";

  if (!parsed) {
    return { action: "OTHER", data: {}, thinkContext: finalThinkContext };
  }

  return { ...parsed, thinkContext: finalThinkContext };
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
        - TIME PHRASING: Use honest relative terms based on the current time (e.g., "due today", "in few days"). NEVER use exact numeric hours/minutes (e.g., "due in 3 hours", "just over 40 minutes"). If a deadline crosses midnight, it is "tomorrow", not "today", regardless of the hour count.
        
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

  // Merge think contexts if available from different sources
  const finalThinkContext = thinkContext || result.thinkContext || "";
  const updatedAt = Date.now();
  // Find the exact task to attach metadata (like deadline)
  const matchedTask = activeTasks.find(t => t.name.toLowerCase().trim() === result.suggestion.toLowerCase().trim());

  return {
    ...result,
    priority,
    thinkContext: finalThinkContext,
    updatedAt,
    deadline: matchedTask?.deadline
  };
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
    const { batchCreateNotionTasks } = await import("./notion-actions");
    const tasksToSync = data.plan.map(t => ({
      title: t.title,
      date: t.date || ""
    }));
    const result = await batchCreateNotionTasks(tasksToSync);
    return {
      success: result.success,
      message: result.success ? `Successfully deployed ${result.count} tasks from your blueprint.` : "Blueprint deployment failed.",
      data: result,
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
    // Check if the user is asking for a roadmap/plan — delegate to generateHorizonRoadmap
    const planKeywords = ["plan", "roadmap", "schedule", "steps for", "build a plan", "create a plan", "how do i", "how to"];
    const isPlanIntent = planKeywords.some(kw => prompt.toLowerCase().includes(kw));
    if (isPlanIntent) {
      const roadmap = await generateHorizonRoadmap(prompt);
      cleanDecision.action = "PLAN";
      cleanDecision.data = {
        planSummary: roadmap.summary,
        plan: roadmap.tasks.map(t => ({
          title: t.title,
          date: t.date,
          durationHours: t.durationHours,
          reason: t.reason
        }))
      };
      finalThinkContext = roadmap.thinkContext || finalThinkContext;
    }

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

const capacityReportCache = new Map<string, CapacityReport>();

let rateLimitCooldownUntil = 0;

/**
 * Persistent memory for task estimations.
 * This prevents the "Shifting Times" bug where marking a task as done
 * changes the hours of the remaining tasks.
 */
const taskEstimationCache = new Map<string, number>();

export async function getCapacityInsights(
  tasks: NotionTask[],
  userOffset: string,
  persistentMemory?: Record<string, number>
): Promise<CapacityReport> {
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);
  const today = localNow.toISOString().split("T")[0];

  if (Date.now() < rateLimitCooldownUntil) {
    const remainingSeconds = Math.ceil((rateLimitCooldownUntil - Date.now()) / 1000);
    // Even when rate limited, we MUST return the known estimations so the UI doesn't show 0.0h
    const estimationsRecord: Record<string, number> = {};
    taskEstimationCache.forEach((hours, key) => {
      const namePart = key.split('-').slice(1).join('-');
      estimationsRecord[namePart || key] = hours;
    });

    return {
      insights: [],
      overallSummary: `Groq AI Rate Limit hit! Pausing analysis for ${remainingSeconds}s... (Event: ${Date.now()})`,
      knownEstimations: estimationsRecord,
      thinkContext: "I have paused my active analysis due to a Groq API Rate Limit, but I am still maintaining your existing task estimations from my memory."
    };
  }

  // 1. Load provided memory into the current execution
  if (persistentMemory) {
    Object.entries(persistentMemory).forEach(([key, value]) => {
      taskEstimationCache.set(key, value);
    });
  }

  // Clean up: Remove tasks that no longer exist to prevent stale memory.
  const currentTaskKeys = new Set(tasks.map(t => `${t.id}-${t.name}`));
  for (const cachedKey of taskEstimationCache.keys()) {
    if (!currentTaskKeys.has(cachedKey)) {
      taskEstimationCache.delete(cachedKey);
    }
  }

  // State: Create a data fingerprint to detect changes across dates/status/names.
  // We include hour so the cache stays fresh but doesn't burn too many tokens.
  const timeKey = `${localNow.getHours()}`;
  const taskFingerprint = `v7|${today}|${timeKey}|` + [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(t => {
      const cachedTime = taskEstimationCache.get(`${t.id}-${t.name}`);
      return `${t.id}-${t.status}-${t.name}-${t.deadline}${cachedTime ? `-[${cachedTime}]` : ''}`;
    })
    .join("|");

  if (capacityReportCache.has(taskFingerprint)) {
    const cached = capacityReportCache.get(taskFingerprint)!;
    // Safety check: if the cached report is empty, force a re-fetch rather than showing "No active tasks"
    if (cached.insights && cached.insights.length > 0) {
      return cached;
    }
  }

  const result = await runCapacityAnalysis(taskFingerprint, tasks, userOffset);

  // Store: Keep new estimations in memory for future parity checks.
  if (result?.insights && Array.isArray(result.insights)) {
    result.insights.forEach(day => {
      if (day.taskInsights && Array.isArray(day.taskInsights)) {
        day.taskInsights.forEach(tInsight => {
          const matched = tasks.find(ot => ot.name === tInsight.name);
          if (matched) {
            taskEstimationCache.set(`${matched.id}-${matched.name}`, tInsight.estimatedHours);
          }
        });
      }
    });
  }

  // Only cache if the report actually contains data to avoid permanent empty-state locks.
  if (result && result.insights && result.insights.length > 0) {
    capacityReportCache.set(taskFingerprint, result);
  }

  return result;
}

async function runCapacityAnalysis(_fingerprint: string, tasks: NotionTask[], userOffset: string): Promise<CapacityReport> {
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);
  const today = localNow.toISOString().split("T")[0];

  // Temporal Awareness
  const endOfDay = new Date(localNow);
  endOfDay.setHours(23, 59, 59, 999);
  const remainingHoursInDay = parseFloat(Math.max(0, (endOfDay.getTime() - localNow.getTime()) / 3600000).toFixed(2));

  let thinkContext = "";
  const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done" && t.deadline && t.deadline !== 'No Deadline');

  // --- PHASE 1: MICRO-AGENT (TASK ESTIMATION) ---
  // Only ask AI to estimate new/unrecognized tasks
  const missingEstimations = activeTasks.filter(t => {
    // ID lookup
    let cached = taskEstimationCache.get(t.id);

    // Name lookup
    if (cached === undefined) {
      cached = taskEstimationCache.get(t.name.trim());
    }

    // Fuzzy lookup
    if (cached === undefined) {
      for (const [key, val] of taskEstimationCache.entries()) {
        const cleanKey = key.split('-').pop() || key;
        if (cleanKey.toLowerCase().trim() === t.name.toLowerCase().trim()) {
          cached = val;
          break;
        }
      }
    }
    return cached === undefined;
  });

  if (missingEstimations.length > 0) {
    const estPrompt = missingEstimations.map(t => `- ID: "${t.id}", Name: "${t.name}"`).join("\n");
    try {
      const estResponse = await groq.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content: `You are an Estimation Agent. Estimate hours (0.5 to 8.0) for each task. Output strict JSON. Format: { "estimations": [{ "id": "task_id", "estimatedHours": 2.5 }] }`
          },
          { role: "user", content: `TASKS TO ESTIMATE:\n${estPrompt}` }
        ]
      });
      const rawEst = estResponse.choices[0]?.message?.content || "";
      const estData = extractJSON<{ estimations: { id: string, name?: string, estimatedHours: number }[] }>(rawEst);
      if (estData && estData.estimations) {
        estData.estimations.forEach(est => {
          // SANITY CLEANING: AI sometimes adds quotes or spaces to IDs
          const cleanEstId = String(est.id).trim().replace(/['"]/g, '');
          const matched = missingEstimations.find(t => {
            const cleanTaskId = String(t.id).trim().replace(/['"]/g, '');
            return cleanTaskId === cleanEstId || t.name.trim().toLowerCase() === String(est.name || "").trim().toLowerCase();
          });

          if (matched && est.estimatedHours > 0) {
            taskEstimationCache.set(matched.id, est.estimatedHours);
            taskEstimationCache.set(matched.name.trim(), est.estimatedHours);
          }
        });
      }
    } catch (e) { console.error("Estimation Model Failed:", e); }
  }

  // --- PHASE 2: TYPESCRIPT CALCULATION ENGINE ---
  const normalizeDate = (deadline: string): string => {
    const parsed = new Date(deadline);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return deadline.split('T')[0];
  };

  const insightsMap = new Map<string, any>();
  insightsMap.set(today, { date: today, totalHours: 0, status: "SAFE", taskInsights: [] }); // Guarantee Today exists

  activeTasks.forEach(t => {
    const d = normalizeDate(t.deadline || today);
    if (!insightsMap.has(d)) insightsMap.set(d, { date: d, totalHours: 0, status: "SAFE", taskInsights: [] });

    const day = insightsMap.get(d);
    const idKey = t.id;
    const nameKey = t.name.trim();

    // Look up by ID (highest precision)
    let est = taskEstimationCache.get(idKey);

    // Fallback to Name (fuzzy matching)
    if (est === undefined) {
      est = taskEstimationCache.get(nameKey);
    }

    if (est === undefined) {
      for (const [key, val] of taskEstimationCache.entries()) {
        const cleanKey = key.split('-').pop() || key;
        if (cleanKey.toLowerCase().trim() === nameKey.toLowerCase()) {
          est = val;
          break;
        }
      }
    }
    // Hard fallback if estimation failed
    if (!est || est <= 0) est = 1.5;

    day.taskInsights.push({ id: t.id, name: t.name, estimatedHours: est });
    day.totalHours += est;
  });

  const insightsArray = Array.from(insightsMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // --- PHASE 3: AGENTIC STATUS & MITIGATION ---
  // Rules: 12+ is OVERLOADED, 9+ is BUSY. Stable thresholds prevent jitter.
  insightsArray.forEach(day => {
    if (day.totalHours >= 12) {
      day.status = "OVERLOADED";
    } else if (day.totalHours >= 9) {
      day.status = "BUSY";
    } else {
      day.status = "SAFE";
    }
  });

  // --- PHASE 3: MICRO-AGENT (MITIGATION CONSULTANT) ---
  let overallSummary = "Your schedule is perfectly balanced! No overloads detected.";
  const overloadedDays = insightsArray.filter(i => i.status === "OVERLOADED");

  if (overloadedDays.length > 0) {
    overallSummary = "I detect some overloaded days. Let's proactively rebalance your workload.";

    const calendarMap = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(localNow);
      d.setDate(d.getDate() + i);
      calendarMap.push(d.toISOString().split('T')[0]);
    }

    const mitigationPrompt = overloadedDays.map(d => JSON.stringify(d)).join("\n");

    try {
      const mitResponse = await groq.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: 3000,
        messages: [
          {
            role: "system",
            content: `You are a Capacity Mitigation Consultant.
            CORE CONSTRAINTS:
            - STRATEGY: Prioritize moving tasks from OVERLOADED days to EARLIER safe dates (including Today) before suggesting future dates.
            - IMPORTANCE-FIRST: Suggest moving the LEAST IMPORTANT tasks first.
            - OUTPUT: Strict JSON schema.
            
            SCHEMA:
            {
              "overallSummary": "A concise, conversational summary of your RECOMMENDATIONS (e.g., 'To reduce the overload on April 8, I suggest moving the least urgent tasks...'). NEVER use active words like 'I am moving' or 'I have moved' as you are only a consultant giving suggestions.",
              "mitigations": [{ 
                "date": "YYYY-MM-DD", 
                "suggestion": "A single, consultative sentence using ONLY Month and Day (e.g., 'April 10'). NEVER INCLUDE THE YEAR: 'I am suggesting moving [Task] to [Formatted Date] to help reduce the heavy load on [Formatted Date].'",
                "mitigationTaskName": "Exact task name", 
                "mitigationTargetDate": "YYYY-MM-DD" 
              }]
            }
            
            CONSULTANT RULE: You are an advisor, not an executor. Use words like 'suggest', 'recommend', 'propose'. DO NOT claim to have moved or changed anything yourself.
            
            PRIORITY RULE: Always propose moves to the EARLIEST next day that has remaining capacity under 9 hours. Do not skip available slots.`
          },
          { role: "user", content: `CALENDAR:\n${calendarMap.join(", ")}\n\nOVERLOADED DAYS TO FIX:\n${mitigationPrompt}` }
        ]
      });
      const rawMit = mitResponse.choices[0]?.message?.content || "";
      const thinkMatch = rawMit.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) thinkContext = thinkMatch[1].trim();

      const mitData = extractJSON<{ mitigations: any[], overallSummary: string }>(rawMit);

      // Helper: Convert YYYY-MM-DD to "Month Day" for suggestion cleanup if AI missed it
      const toHumanDate = (iso: string) => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      };

      if (mitData) {
        if (mitData.overallSummary) overallSummary = mitData.overallSummary.replace(/,?\s*\d{4}/g, "");
        if (mitData.mitigations) {
          mitData.mitigations.forEach(mit => {
            const targetDay = insightsArray.find(i => i.date === mit.date);
            if (targetDay) {
              const isPastMove = mit.mitigationTargetDate < today;
              const isSameDay = mit.mitigationTargetDate === mit.date;

              // Clean up suggestion: Replace any ISO strings with human dates AND strip any accidental years
              let cleanSuggestion = (mit.suggestion || "").replace(/,?\s*\d{4}/g, "");
              const isoRegex = /\d{4}-\d{2}-\d{2}/g;
              cleanSuggestion = cleanSuggestion.replace(isoRegex, (match: string) => toHumanDate(match));

              if (isPastMove || isSameDay) { // Fallback Guard
                targetDay.mitigationTargetDate = today;
                targetDay.suggestion = cleanSuggestion.replace(toHumanDate(mit.mitigationTargetDate), "Today");
              } else {
                targetDay.suggestion = cleanSuggestion;
                targetDay.mitigationTargetDate = mit.mitigationTargetDate;
              }
              targetDay.mitigationTaskName = mit.mitigationTaskName;
            }
          });
        }
      }
    } catch (e) { console.error("Mitigation Consultant Failed:", e); }

    // Summary normalization logic
    const topOverload = Math.max(...overloadedDays.map(o => o.totalHours)).toFixed(1);
    const numberRegex = new RegExp(`(\\d+\\.\\d+|\\d+)(?=\\s*h|\\s*hours?)`, 'gi');
    overallSummary = overallSummary.replace(numberRegex, () => `${topOverload}`);
  }

  // --- REPORT PACKAGING ---
  const estimationsRecord: Record<string, number> = {};
  taskEstimationCache.forEach((hours, key) => {
    const namePart = key.split('-').slice(1).join('-');
    estimationsRecord[namePart || key] = hours;
  });
  return {
    insights: insightsArray,
    overallSummary,
    knownEstimations: estimationsRecord,
    thinkContext
  };
}


// Focus Horizon: Automatic Project Breakdown
export interface HorizonTaskEntry {
  date: string; // YYYY-MM-DD
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

  // 1. Fetch the unified capacity insight report
  // This ensures Horizon uses the EXACT same logic as Strategy / AgentEngine
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

  const today = new Date().toISOString().split("T")[0];

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are the Focus Horizon AI. The user will provide a high-level project goal.
        Today is ${today}.
        
        YOUR MISSION: Architect a project roadmap that fits the user's REAL-WORLD capacity.
        
        USER'S CURRENT WORKLOAD (FROM OTHER PROJECTS):
        ${capacityContext}
        
        PLANNING RULES:
        1. STRATEGIC SEQUENCING: Prioritize your REAL-WORLD availability. Look at the CURRENT WORKLOAD above before assigning tasks.
        2. SMART AVOIDANCE: If a date is labeled "BUSY" or "OVERLOADED" (meaning it has >= 9 hours of work), DO NOT schedule new tasks on that day. Skip it and find the next available day with < 7 hours of existing work to ensure you don't instantly make it "BUSY".
        3. HARD CAP: Ensure the NEW roadmap tasks + EXISTING workload never exceed 12 hours total for any single day.
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
