"use server";
import { groq, getGroqModel } from "@/lib/groq";
import { fetchNotionTasks } from "./notion-actions";
import { extractJSON, getUrgencyCategory, calculateDeadlineInfo, getUserLocalTime, normalizeStatus } from "@/lib/utils";

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
    targetDatabase?: string;
    planSummary?: string;
    plan?: Array<{
      title: string;
      date?: string;
      durationHours?: number;
      reason?: string;
    }>;
  };
}



export async function processUserPrompt(prompt: string, taskContext: string, userOffset: string, databaseNames: string[] = []): Promise<AgentResponse & { thinkContext?: string }> {
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);
  const today = localNow.toISOString().split("T")[0];
  const dayName = localNow.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const currentTime = localNow.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });


  const dbListStr = databaseNames.length > 0
    ? `\n\nAVAILABLE DATABASES: ${databaseNames.map(n => `"${n}"`).join(", ")}\n- For CREATE: pick the most logical database based on the task context. Set "targetDatabase" to the exact database name.\n- For UPDATE/DELETE: the taskId is globally unique, no database routing needed.`
    : "";

  const response = await groq.chat.completions.create({
    model: await getGroqModel(),
    messages: [
      {
        role: "system",
        content: `You are a Notion Task Agent. Today is ${dayName}, ${today}. Current Time is ${currentTime}. Timezone offset: ${userOffset}.

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

  const msg = response.choices[0]?.message;
  const rawContent = msg?.content || "";
  const reasoning = (msg as any)?.reasoning || (msg as any)?.reasoning_content || "";
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContext = thinkMatch ? thinkMatch[1].trim() : (reasoning ? reasoning.trim() : "");
  const parsed = extractJSON<AgentResponse>(rawContent);

  return { ...parsed, thinkContext: thinkContext || (parsed as any)?.thinkContext || "" } as any;
}

export async function getAgentSuggestion(
  tasks: NotionTask[],
  userOffset: string = "+00:00",
  previousSuggestion?: AgentSuggestion | null
): Promise<AgentSuggestion | null> {
  const { now, localNow } = getUserLocalTime(userOffset);
  const dayName = localNow.toLocaleDateString('en-US', { weekday: 'long' });

  const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");
  if (activeTasks.length === 0) return null;

  const taskContext = activeTasks
    .map(t => {
      const { deadlineLabel, relativeInfo } = calculateDeadlineInfo(t.deadline, localNow, now);
      return `- ${t.name} (Status: ${t.status || "N/A"}, Deadline: ${deadlineLabel} | ${relativeInfo})`;
    })
    .join("\n");

  // Continuity Context: Check if the previous recommendation is still active in the task list
  let previousContextPrompt = "";
  if (previousSuggestion && previousSuggestion.suggestion) {
    const isPrevStillActive = activeTasks.some(
      t => t.name.toLowerCase().trim() === previousSuggestion.suggestion.toLowerCase().trim()
    );

    if (isPrevStillActive) {
      previousContextPrompt = `
        PREVIOUS RECOMMENDATION:
        - Task Name: "${previousSuggestion.suggestion}"
        - Previous Priority: "${previousSuggestion.priority || 'HIGH'}"
        
        DECISION STABILITY & CONTINUITY PRINCIPLE:
        - The user was previously recommended to work on "${previousSuggestion.suggestion}".
        - That task is STILL ACTIVE in their task list.
        - PRESERVE "${previousSuggestion.suggestion}" as your recommendation UNLESS there is a major, compelling shift (such as a new meeting happening in the next 1-2 hours, or a task becoming critical).
        - Do NOT flip-flop or change your recommendation between tasks of similar priority. Maintain user focus!
      `;
    }
  }

  const response = await groq.chat.completions.create({
    model: await getGroqModel(),
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are an Expert Executive Assistant. Today is ${dayName}, ${localNow.toISOString().split("T")[0]}.
        
        MISSION: Your goal is to help to manage the day by recommending the single most logical next step from the task list.
        ${previousContextPrompt}
        
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

  const msg = response.choices[0]?.message;
  const rawContent = msg?.content || "";
  const reasoning = (msg as any)?.reasoning || (msg as any)?.reasoning_content || "";
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContext = thinkMatch ? thinkMatch[1].trim() : (reasoning ? reasoning.trim() : "");
  const result = extractJSON<AgentSuggestion>(rawContent);

  // Validation: ensure the critical fields and correct types exist
  if (!result || !result.suggestion || !result.reason || typeof result.confidence !== "number") {
    throw new Error("AI returned invalid or incomplete suggestion data.");
  }

  // Fallback for priority if LLM misses it
  const priority = (result.priority || "MEDIUM") as any;

  const matchedTask = activeTasks.find(t => t.name.toLowerCase().trim() === result.suggestion.toLowerCase().trim());

  return {
    ...result,
    priority,
    thinkContext,
    updatedAt: Date.now(),
    deadline: matchedTask?.deadline
  };
}

export async function performNotionCRUD(
  action: AgentActions,
  data: AgentResponse["data"],
  aiSuggestion?: AgentSuggestion | null,
  listMessage?: string,
  databases?: Array<{ id: string; name: string }>
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const { createNotionTask, updateNotionTask, deleteNotionTask, batchCreateNotionTasks, fetchNotionTasks: fetchAll } = await import("./notion-actions");

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

    let propNames: { status: string; date: string } | undefined;
    let propTypes: { status: "status" | "select" } | undefined;

    const tasks = await fetchAll(databases as any);
    const matchedTask = tasks.find(t => t.id === data.taskId);
    if (matchedTask?.propNames) {
      propNames = matchedTask.propNames;
      propTypes = matchedTask.propTypes;
    }

    const status = data.status ? normalizeStatus(data.status) : undefined;
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

export async function executeUserPrompt(prompt: string, userOffset: string = "+00:00") {
  if (!prompt || !prompt.trim()) {
    return {
      success: false,
      message: "Please enter a prompt.",
      actionTaken: null,
      notionResponse: null,
    };
  }

  const { discoverDatabases, fetchNotionTasks: fetchAll } = await import("./notion-actions");
  const databases = await discoverDatabases();
  const tasks = await fetchAll(databases);
  const databaseNames = databases.map(db => db.name);

  // Include database name in task context so the AI knows which DB each task belongs to
  const taskContext = tasks.map(t => `- Name: "${t.name}", ID: "${t.id}", Status: "${t.status || 'No Status'}", Deadline: "${t.deadline || 'No Deadline'}"${t.databaseName ? `, Database: "${t.databaseName}"` : ""}`).join("\n");
  const decision = await processUserPrompt(prompt, taskContext, userOffset, databaseNames);

  let message = "";
  let aiSuggestion: AgentSuggestion | null = null;
  let finalThinkContext = decision.thinkContext || "";

  if (decision.action === "READ") {
    if (tasks.length === 0) message = "You have no tasks in your list.";
  }
  else if (decision.action === "SUGGEST") {
    const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");
    if (activeTasks.length === 0) {
      return {
        success: true,
        message: "You have no active tasks to prioritize. Add some tasks first!",
        actionTaken: decision,
        tasks,
        thinkContext: finalThinkContext,
      };
    }
    aiSuggestion = await getAgentSuggestion(tasks, userOffset);
    if (aiSuggestion && aiSuggestion.thinkContext) {
      finalThinkContext = aiSuggestion.thinkContext;
    }
  }
  else if (decision.action === "UNCLEAR") {
    return {
      success: false,
      message: `I couldn't find a task named "${decision.data.attemptedName}". Please check the task name in your list and try again!`,
      actionTaken: decision,
      tasks,
      thinkContext: finalThinkContext,
    };
  }
  else if (decision.action === "OTHER") {
    const planKeywords = ["plan", "roadmap", "schedule", "steps for", "build a plan", "create a plan", "how do i", "how to"];
    const isPlanIntent = planKeywords.some(kw => prompt.toLowerCase().includes(kw));
    if (isPlanIntent) {
      const { generateHorizonRoadmap } = await import("./horizon-actions");
      const roadmap = await generateHorizonRoadmap(prompt, userOffset);
      decision.action = "PLAN";
      decision.data = {
        planSummary: roadmap.summary,
        plan: roadmap.tasks
      };
      finalThinkContext = roadmap.thinkContext || finalThinkContext;
    }

    return {
      success: true,
      message: "I'm a task assistant, specialized in managing tasks. Ask me something related to managing your tasks.",
      actionTaken: decision,
      notionResponse: null,
      tasks,
      thinkContext: finalThinkContext,
    };
  }

  // For CRUD mutations, pause and return to UI for human confirmation before touching Notion
  if (decision.action === "CREATE" || decision.action === "UPDATE" || decision.action === "DELETE" || decision.action === "PLAN") {

    if (tasks.length === 0 && (decision.action === "DELETE" || decision.action === "UPDATE")) {
      return {
        success: false,
        message: "You have no tasks in your list to modify.",
        actionTaken: decision,
        tasks,
        thinkContext: finalThinkContext,
      };
    }

    if ((decision.action === "DELETE" || decision.action === "UPDATE") && !decision.data.taskId) {
      return {
        success: false,
        message: "I couldn't identify which task to modify. Please check the task name in your list and try again!",
        actionTaken: decision,
        tasks,
        thinkContext: finalThinkContext,
      };
    }

    let pendingTaskName = decision.data.title || "";
    if ((decision.action === "UPDATE" || decision.action === "DELETE") && decision.data.taskId) {
      const matchedTask = tasks.find(t => t.id === decision.data.taskId);
      pendingTaskName = matchedTask?.name || decision.data.taskId || "";
    } else if (decision.action === "PLAN") {
      pendingTaskName = `Proposed Plan (${decision.data.plan?.length || 0} tasks)`;
    }

    // Deadline conflict detection
    let deadlineConflict = false;
    let conflictingTaskNames: string[] = [];
    if (decision.action === "CREATE" && decision.data.date) {
      const newDate = decision.data.date.split("T")[0];
      const conflicts = tasks.filter(t => {
        if (!t.deadline || t.status?.toLowerCase() === "done") return false;
        return t.deadline.split("T")[0] === newDate;
      });
      if (conflicts.length > 0) {
        deadlineConflict = true;
        conflictingTaskNames = conflicts.map(t => t.name);
      }
    }

    // Duplicate task detection
    let duplicateTask = false;
    let duplicateTaskName = "";
    if (decision.action === "CREATE" && decision.data.title) {
      const newTitle = decision.data.title.toLowerCase().trim();
      const match = tasks.find(t => t.name.toLowerCase().trim() === newTitle);
      if (match) {
        duplicateTask = true;
        duplicateTaskName = match.name;
      }
    }

    return {
      success: true,
      requiresConfirmation: true as const,
      pendingDecision: decision,
      pendingTaskName,
      message: "",
      actionTaken: decision,
      notionResponse: null,
      tasks,
      thinkContext: finalThinkContext,
      deadlineConflict,
      conflictingTaskNames,
      duplicateTask,
      duplicateTaskName,
    };
  }

  const result = await performNotionCRUD(decision.action, decision.data, aiSuggestion, message, databases);

  return {
    success: result.success,
    message: message || result.message,
    actionTaken: decision,
    notionResponse: result,
    tasks: result.success ? tasks : undefined,
    thinkContext: finalThinkContext,
  };
}

export async function confirmAction(decision: AgentResponse) {
  const { discoverDatabases } = await import("./notion-actions");
  const databases = await discoverDatabases();
  const result = await performNotionCRUD(decision.action, decision.data, null, undefined, databases);
  const { fetchNotionTasks: fetchAll } = await import("./notion-actions");
  const returnTasks = result.success ? await fetchAll(databases) : undefined;
  return {
    success: result.success,
    message: (result as any).message || (result.success ? "Action confirmed." : "Action failed."),
    tasks: returnTasks,
  };
}
