"use server";
import { groq, GROQ_MODEL } from "@/lib/groq";
import { fetchNotionTasks } from "./notion-actions";

export interface NotionTask {
  id: string;
  name: string;
  status?: string;
  deadline?: string;
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
    planSummary?: string;
    plan?: Array<{
      title: string;
      date?: string;
      reason?: string;
    }>;
  };
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

    if (isDateOnly) {
      const localDateObj = new Date(localNow.toISOString().split("T")[0] + "T00:00:00Z");
      const dlDateObj = new Date(deadline + "T00:00:00Z");
      const diffDays = Math.round((dlDateObj.getTime() - localDateObj.getTime()) / 86400000);

      if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        const sortHrs = (absDays * 24).toString().padStart(2, '0');
        relativeInfo = ` [SortKey: -${sortHrs}h] (${absDays} days overdue)`;
      } else if (diffDays === 0) {
        relativeInfo = ` [SortKey: 00h] (due today)`;
      } else {
        const sortHrs = (diffDays * 24).toString().padStart(2, '0');
        relativeInfo = ` [SortKey: ${sortHrs}h] (due in ${diffDays} days)`;
      }
    } else {
      // Comparison for relativity with higher precision
      const diffMs = dlDate.getTime() - now.getTime();
      const totalMinutes = Math.floor(diffMs / 60000);

      if (totalMinutes < 0) {
        const absMins = Math.abs(totalMinutes);
        const hoursAgo = Math.floor(absMins / 60);
        const minsAgo = absMins % 60;
        const paddedHoursAgo = hoursAgo.toString().padStart(2, '0');
        relativeInfo = hoursAgo >= 24
          ? ` [SortKey: -${paddedHoursAgo}h] (${Math.floor(hoursAgo / 24)}d ${hoursAgo % 24}h overdue)`
          : ` [SortKey: -${paddedHoursAgo}h] (${hoursAgo}h ${minsAgo}m overdue)`;
      } else {
        const hoursLeft = Math.floor(totalMinutes / 60);
        const minsLeft = totalMinutes % 60;
        const paddedHoursLeft = hoursLeft.toString().padStart(2, '0');
        relativeInfo = hoursLeft >= 24
          ? ` [SortKey: ${paddedHoursLeft}h] (due in ${Math.floor(hoursLeft / 24)}d ${hoursLeft % 24}h)`
          : ` [SortKey: ${paddedHoursLeft}h] (due in ${hoursLeft}h ${minsLeft}m)`;
      }
    }
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

        return `- ${t.name} (Status: ${t.status || "N/A"}, Deadline: ${deadlineLabel}${relativeInfo})`;
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
        - Math Check: Trust the pre-calculated time differences (SortKey).
        - Strict Interpretation: Generic/Dummy tasks (like "abc", "test", "hhh") are the absolute BOTTOM. A real leisure task (like "watch a movie") ALWAYS takes precedence over a dummy placeholder.
        - Communication: Explain your choice casually as if you are a human assistant talking to your boss. DO NOT use technical robotic phrases like "Dummy tasks are prioritized", "According to the Impact rule". Instead, use conversational reasoning.
        - TIME PHRASING: Use honest relative terms based on the current time (e.g., "by later today", "tomorrow afternoon", "in a few days"). NEVER use exact numeric hours/minutes. If a deadline crosses midnight, it is "tomorrow", not "today", regardless of the hour count.
        - NO INTERNAL EXPOSURE: NEVER mention internal terms like "CRITICAL", "HIGH", "SortKey", etc. NEVER mention numeric hour ranges (like 00h-23.99h). NEVER mention task categories like "Professional", "Leisure", or "Placeholder". Just give a natural human reason.
        
        PRIORITY LOGIC (STRICT HIERARCHY):
          1. EVALUATE TASK TYPE (Rule #1): 
             - If task is Generic/Placeholder (e.g. "abc", "test", "hhh") -> Priority is ALWAYS "LOW".
             - If task is Leisure (e.g. "watch movie", "play games") -> Priority is ALWAYS "LOW".
          2. EVALUATE DEADLINE MATH (Rule #2 - ONLY for Professional Tasks):
             - IF SortKey is Negative (e.g. -01h, -48h) -> "CRITICAL".
             - IF SortKey is 00h up to 23.99h -> "CRITICAL" (Exactly 24h is HIGH).
             - IF SortKey is 24h up to 71.99h -> "HIGH" (Exactly 72h is MEDIUM).
             - IF SortKey is 72h up to 167.99h -> "MEDIUM" (Exactly 168h is LOW).
             - IF SortKey is 168h or Greater -> "LOW".
          
          STRICT RULES:
          - ABSOLUTE PRIORITY: NEVER use relative priority. If the math says "LOW", the label MUST be "LOW", even if it is the most urgent task in the entire list.
          - NO ROUNDING: Do not round SortKey values. Treat them as precise floating point numbers.
          - IMPACT CHECK: Rule #1 always wins. An overdue movie is LOW. A placeholder due in 1 hour is LOW.
          - MATH REALITY CHECK: 24h is exactly 24.0. Since 24.0 is NOT less than 23.99, it is HIGH (not Critical). 72h is MEDIUM. 168h is LOW.
        
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
export async function processUserPrompt(prompt: string, taskContext: string, userOffset: string): Promise<AgentResponse & { thinkContext?: string }> {
  const today = new Date().toISOString().split("T")[0];

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a Notion Task Agent.Today is ${today}.Timezone offset: ${userOffset}.

        EXISTING TASKS:
      ${taskContext}

  ACTIONS(choose one):
  - CREATE: New task.Extract: title, status(default "To Do"), date(only if user mentions one).
  - READ: List / view tasks.
        - UPDATE: Modify task properties.Extract: taskId, status, date.
        - DELETE: Remove task.Extract: taskId.
        - SUGGEST: Prioritization advice(e.g. "what is urgent?").
        - PLAN: Perform "Cognitive Load-Aware Constraint Solving" to generate a sequential roadmap of 3 - 6 logical subtasks.
          WEIGHTED CAPACITY PACKING: Do not perform binary skipping of busy days.Instead, perform a pre - computation of the user's existing "Temporal Density" using these Cognitive Load weights:
    - CRITICAL: 3 units | HIGH: 2 units | MEDIUM: 1 unit | LOW: 0.5 units.
          - DAILY CAPACITY: Each day has a 4 - unit threshold.
          Distribute new subtasks(assume 1 unit each) by filling the remaining capacity on days where EXISTING TASKS do not already reach the 4 - unit limit.Only skip days that are at maximum theoretical capacity.
          NEVER use a Task ID as a title.Extract: a concise 'planSummary'(1 - 2 sentences) providing a density - based feasibility analysis(e.g., "I scheduled Step 2 on Tuesday as your existing low-weight tasks leave 3 units of cognitive headroom"), and an array of subtasks with title, date, and reason in the 'plan' array.
        - UNCLEAR: UPDATE / DELETE intent but no task confidently matches.Set attemptedName.
        - OTHER: Non task topics.

        DATE RULES:
  - Only include date / time if user explicitly mentions it.Never assume today or midnight.
        - Relative dates("tomorrow", "next Friday") → calculate from ${today}.
  - Time mentioned → ISO 8601: YYYY - MM - DDTHH: mm:ss${userOffset}. No time → YYYY - MM - DD only.

    MATCHING(UPDATE / DELETE):
  - Match by core keywords, case -insensitive, ignore filler words("a", "the", "an").
        - Only match if exactly ONE task clearly fits.Ambiguous / no match → UNCLEAR.
        - Use exact taskId from the task list.

    OUTPUT(strict JSON):
  {
    "action": "CREATE|READ|UPDATE|DELETE|SUGGEST|PLAN|UNCLEAR|OTHER",
      "data": {
      "taskId": "", "status": "", "title": "", "date": "", "attemptedName": "",
        "planSummary": "Short feasibility analysis here",
          "plan": [{ "title": "", "date": "", "reason": "" }]
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
  listMessage?: string
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const { createNotionTask, updateNotionTask, deleteNotionTask } = await import("./notion-actions");

  if (action === "CREATE") {
    const title = (data.title ?? "").trim() || "New Task";
    const status = normalizeStatus(data.status);
    const result = await createNotionTask(title, status, data.date);
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
    for (const task of data.plan) {
      const title = (task.title ?? "").trim() || "New Task";
      // Default to not started
      const status = normalizeStatus("Not started");
      results.push(await createNotionTask(title, status, task.date));
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

    // Normalize status if it exists in the data
    const status = data.status ? normalizeStatus(data.status) : undefined;

    // Pass both status and date to the update function
    const result = await updateNotionTask(data.taskId, status, data.date);

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

  const tasks = await fetchNotionTasks();
  const taskContext = tasks.map(t => `- Name: "${t.name}", ID: "${t.id}", Status: "${t.status || 'No Status'}", Deadline: "${t.deadline || 'No Deadline'}"`).join("\n");
  const decision = await processUserPrompt(prompt, taskContext, userOffset);
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
  const result = await performNotionCRUD(cleanDecision.action, cleanDecision.data, aiSuggestion, message);

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
  const result = await performNotionCRUD(decision.action, decision.data);
  const returnTasks = result.success ? await fetchNotionTasks() : undefined;
  return {
    success: result.success,
    message: result.message,
    tasks: returnTasks,
  };
}
