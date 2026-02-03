"use server";
import { groq } from "@/lib/groq";
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

export type AgentActions = "CREATE" | "READ" | "UPDATE" | "DELETE" | "SUGGEST" | "OTHER";
export interface AgentResponse {
  action: AgentActions;
  data: {
    title?: string;
    status?: string;
    date?: string;
    taskId?: string;
  };
}


// Gives which task needs to do for the user based on urgency (For proactive suggestions)
export async function getAgentSuggestion( tasks: NotionTask[]) : Promise<AgentSuggestion> {
  const today = new Date().toISOString().split("T")[0];

  const taskContext = tasks
    .map(
      (t: NotionTask) =>
        `- ${t.name} (Status: ${t.status || "N/A"}, Deadline: ${
          t.deadline || "No Deadline"
        })`
    )
    .join("\n");

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a Priority Logic Engine. Today is ${today}.
        
        LOGIC RULES:
        1. **Deadlines**: Closest deadline wins. If overdue, set priority to 'CRITICAL'.
        2. **No Deadline**: Treat as 'LOW' priority unless title is urgent.
        3. **Status**: Prioritize 'In Progress' over 'To Do' for equal deadlines.
        4. **Tie-breaker**: Pick the most technically complex task.

        FORMATTING RULES:
        1. The 'reason' MUST follow this structure: "I'm recommending you to take [Task Name] because [specific logic about deadlines, days remaining, or status]."
        2. Output MUST be a valid JSON object with: 'suggestion', 'reason', 'priority', and 'confidence' (0-1).`,
      },
      { role: "user", content: `Analyze these tasks:\n${taskContext}` },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AgentSuggestion;
}


// Analyze user prompt and decides which action needs to take
export async function processUserPrompt( prompt: string, taskContext: string ): Promise<AgentResponse> {
  const today = new Date().toISOString().split("T")[0];

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a Priority Logic Engine. Today is ${today}.

        EXISTING TASKS:
        ${taskContext}

        DATE RULES:
        1. Use ${today} as your anchor date.
        2. Calculate relative dates (like "tomorrow", "next Monday", "in 3 days") mathematically from this anchor.
        3. "Next [Day]" refers to the upcoming occurrence of that day after ${today}.
        4. ALWAYS output dates in YYYY-MM-DD format only.

        Analyze the user's request and categorize it into one of these actions:
        1. CREATE: User wants to add a new task.
        2. READ: User just wants to see their tasks.
        3. UPDATE: User wants to change an existing task status.
        4. DELETE: User wants to delete a task.
        5. SUGGEST: User wants advice or prioritization (e.g., "what should I do next?", "what is urgent?").
        6. OTHER: Use this if the user asks a general question, or anything unrelated to managing Notion tasks (e.g., "What is the longest river?").

        For CREATE, extract: 'title', 'status' (default: "To Do"), and 'date'.
        For UPDATE or DELETE, extract: 'taskId'. For UPDATE, also extract: 'status'.
        
        Output MUST be JSON: { "action": "CREATE" | "READ" | "UPDATE" | "DELETE" | "SUGGEST" | "OTHER", "data": { ... } }`,
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AgentResponse;
}


// Understand status of the task based on user prompt
function normalizeStatus( input?: string ): "Not started" | "In Progress" | "Done" {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "done" || s === "complete" || s === "completed") return "Done";
  if (s === "in progress" || s === "inprogress" || s === "in-process" || s === "inprocess")
    return "In Progress";
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
export async function executeUserPrompt(prompt: string) {
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
  const decision = await processUserPrompt(prompt, taskContext);

  let message = "";
  let aiSuggestion;

  if (decision.action === "READ") {
    // Format the current tasks as a list
    message = tasks.length > 0 
    ? `Here are your current tasks:\n\n` + 
    tasks.map(t => {
      const deadline = t.deadline ? ` (Due: ${t.deadline})` : " (No deadline)";
      return `• ${t.name} [${t.status}]${deadline}`;
    }).join("\n")
    : "You have no tasks in your list.";
  } 
  else if (decision.action === "SUGGEST") {
    // Run the Logic Engine for prioritization advice
    aiSuggestion = await getAgentSuggestion(tasks);
  }
  else if (decision.action === "OTHER") {
    return {
      success: true,
      message: "I'm a task assistant, specialized in managing tasks. Ask me something related with managing your tasks.",
      actionTaken: decision,
      notionResponse: null
    };
  }

  // Pass to CRUD (READ/SUGGEST will return success without Notion changes)
  const result = await performNotionCRUD(decision.action, decision.data, aiSuggestion, message);

  return {
    success: result.success,
    message: message || result.message,
    actionTaken: decision,
    notionResponse: result,
  };
}
