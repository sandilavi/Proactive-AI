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
}

export type AgentActions = "CREATE" | "READ" | "UPDATE" | "DELETE" | "SUGGEST" | "UNCLEAR" | "OTHER";
export interface AgentResponse {
  action: AgentActions;
  data: {
    title?: string;
    status?: string;
    date?: string;
    taskId?: string;
    attemptedName?: string;
  };
}


// Gives which task needs to do for the user based on urgency (For proactive suggestions)
export async function getAgentSuggestion(tasks: NotionTask[]): Promise<AgentSuggestion> {
  const today = new Date().toISOString().split("T")[0];

  // Only consider active (non-done) tasks
  const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");
  if (activeTasks.length === 0) throw new Error("No active tasks to suggest.");

  const taskContext = activeTasks
    .map(
      (t: NotionTask) => {
        let daysInfo = "";
        if (t.deadline && t.deadline !== "No Deadline") { // Calculate how many days left to the deadline
          const dlDate = new Date(t.deadline);
          const now = new Date();
          const diffTime = dlDate.getTime() - now.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays > 0) daysInfo = `, ${diffDays} days away`;
          else if (diffDays === 0) daysInfo = `, Due today`;
          else daysInfo = `, ${Math.abs(diffDays)} days overdue`;
        }
        const deadlineLabel = t.deadline && t.deadline !== "No Deadline"
          ? new Date(t.deadline).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric" })
          : "No Deadline";
        return `- ${t.name} (Status: ${t.status || "N/A"}, Deadline: ${deadlineLabel}${daysInfo})`;
      }
    )
    .join("\n");

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a Priority Logic Engine. Today is ${today}.
        
        PRIORITIZATION LOGIC (Follow in strict order):
        STEP 1: Identify all OVERDUE tasks (deadlines in the past relative to today). If any exist, you MUST pick the one with the oldest/earliest past date and set priority to 'CRITICAL'.
        STEP 2 (COMPLEXITY FILTER): If the task chosen in Step 1 is a trivial, nonsense, or non-technical task (e.g., "watch a movie", "take out the trash"), DISCARD it and pick the NEXT most overdue technical/important task.
        STEP 3: If and ONLY IF no tasks are overdue, pick the task with the closest upcoming deadline (e.g., Due today).
        STEP 4: If deadlines are exactly identical, pick the task marked 'In Progress' over 'Not started'.
        STEP 5: Tasks with 'No Deadline' are the lowest priority.

        FORMATTING RULES:
        1. Write the 'reason' in plain, natural language as if explaining to the user directly. Do NOT mention rule numbers, rule names, or internal logic labels (e.g. never say "Rule 1" or "according to the tie-breaker rule").
        2. IMPORTANT: Never use the words "dull", "non-dull", "trivial", or explain the complexity filter to the user. Just say it is the most critical overdue task or has high importance. 
        3. The 'reason' MUST follow this structure: "I'm recommending you to take [Task Name] because [specific explanation about deadlines, days remaining, or status in natural language]."
        4. Output MUST be a valid JSON object with: 'suggestion', 'reason', 'priority', and 'confidence' (0-1).`,
      },
      { role: "user", content: `Analyze these tasks:\n${taskContext}` },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AgentSuggestion;
}


// Analyze user prompt and decides which action needs to take
export async function processUserPrompt(prompt: string, taskContext: string, userOffset: string): Promise<AgentResponse & { thinkContext?: string }> {
  const today = new Date().toISOString().split("T")[0];

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a Notion Task Agent. Today is ${today}. Timezone offset: ${userOffset}.

        EXISTING TASKS:
        ${taskContext}

        ACTIONS (choose one):
        - CREATE: New task. Extract: title, status (default "To Do"), date (only if user mentions one).
        - READ: List/view tasks.
        - UPDATE: Modify task properties. Extract: taskId, status, date.
        - DELETE: Remove task. Extract: taskId.
        - SUGGEST: Prioritization advice (e.g. "what is urgent?").
        - UNCLEAR: UPDATE/DELETE intent but no task confidently matches. Set attemptedName.
        - OTHER: Non-task topics.

        DATE RULES:
        - Only include date/time if user explicitly mentions it. Never assume today or midnight.
        - Relative dates ("tomorrow", "next Friday") → calculate from ${today}.
        - Time mentioned → ISO 8601: YYYY-MM-DDTHH:mm:ss${userOffset}. No time → YYYY-MM-DD only.

        MATCHING (UPDATE/DELETE):
        - Match by core keywords, case-insensitive, ignore filler words ("a", "the", "an").
        - Only match if exactly ONE task clearly fits. Ambiguous/no match → UNCLEAR.
        - Use exact taskId from the task list.

        OUTPUT (strict JSON):
        { "action": "CREATE|READ|UPDATE|DELETE|SUGGEST|UNCLEAR|OTHER", "data": { "taskId": "", "status": "", "title": "", "date": "", "attemptedName": "" } }`,
      },
      { role: "user", content: prompt },
    ],
    // NOTE: We intentionally do NOT set response_format: json_object here.
    // That option suppresses the <think> block entirely.
    // Instead, we manually extract the JSON from the raw text below.
  });

  let rawContent = response.choices[0]?.message?.content || "{}";
  let thinkContext = "";

  // Extract <think>...</think> if LLM includes it before the JSON
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinkContext = thinkMatch[1].trim();
    rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>\n*/, "").trim();
  }

  // Manually extract the JSON object from the remaining raw text
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  const jsonString = jsonMatch ? jsonMatch[0] : "{}";

  const parsed = JSON.parse(jsonString) as AgentResponse;
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
  aiSuggestion?: AgentSuggestion,
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

  return { success: false, message: `Unsupported action: ${action}` };
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
  const taskContext = tasks.map(t => `- Name: "${t.name}", ID: "${t.id}"`).join("\n");
  const decision = await processUserPrompt(prompt, taskContext, userOffset);
  const { thinkContext, ...decisionData } = decision;
  const cleanDecision = decisionData as AgentResponse;

  let message = "";
  let aiSuggestion;

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
        thinkContext,
      };
    }
    // Run the Logic Engine for prioritization advice
    aiSuggestion = await getAgentSuggestion(tasks);
  }
  else if (cleanDecision.action === "UNCLEAR") {
    return {
      success: false,
      message: `I couldn't find a task named "${cleanDecision.data.attemptedName}". Please check the task name in your list and try again!`,
      actionTaken: cleanDecision,
      tasks,
      thinkContext,
    };
  }
  else if (cleanDecision.action === "OTHER") {
    return {
      success: true,
      message: "I'm a task assistant, specialized in managing tasks. Ask me something related to managing your tasks.",
      actionTaken: cleanDecision,
      notionResponse: null,
      tasks,
      thinkContext,
    };
  }

  // For CRUD mutations, pause and return to UI for human confirmation before touching Notion
  if (cleanDecision.action === "CREATE" || cleanDecision.action === "UPDATE" || cleanDecision.action === "DELETE") {

    // Guard: no tasks in Notion at all — nothing to delete or update
    if (tasks.length === 0 && (cleanDecision.action === "DELETE" || cleanDecision.action === "UPDATE")) {
      return {
        success: false,
        message: "You have no tasks in your list to modify.",
        actionTaken: cleanDecision,
        tasks,
        thinkContext,
      };
    }

    // Guard: LLM returned DELETE/UPDATE but couldn't identify a valid taskId
    if ((cleanDecision.action === "DELETE" || cleanDecision.action === "UPDATE") && !cleanDecision.data.taskId) {
      return {
        success: false,
        message: "I couldn't identify which task to modify. Please check the task name in your list and try again!",
        actionTaken: cleanDecision,
        tasks,
        thinkContext,
      };
    }

    // Resolve a human-readable name for the confirmation card
    let pendingTaskName = cleanDecision.data.title || "";
    if ((cleanDecision.action === "UPDATE" || cleanDecision.action === "DELETE") && cleanDecision.data.taskId) {
      const matchedTask = tasks.find(t => t.id === cleanDecision.data.taskId);
      pendingTaskName = matchedTask?.name || cleanDecision.data.taskId || "";
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
      thinkContext,
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
    thinkContext,
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
