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

  const taskContext = tasks
    .map(
      (t: NotionTask) =>
        `- ${t.name} (Status: ${t.status || "N/A"}, Deadline: ${t.deadline || "No Deadline"
        })`
    )
    .join("\n");

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
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
export async function processUserPrompt(prompt: string, taskContext: string, userOffset: string): Promise<AgentResponse> {
  const today = new Date().toISOString().split("T")[0];

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a Priority Logic Engine. Today is ${today}.
    
        EXISTING TASKS IN NOTION:
        ${taskContext}
    
        TIMEZONE & DATE RULES:
        1. Anchor Date: ${today}. Timezone Offset: ${userOffset}.
        2. Relative Dates: Calculate "tomorrow", "next [day]", "in X days" mathematically from ${today}.
        3. Time Formatting: If user mentions time (e.g. "3pm"), output ISO 8601: YYYY-MM-DDTHH:mm:ss${userOffset}.
        4. Date-Only: If no time mentioned, use YYYY-MM-DD.
    
        ACTION CATEGORIES & HIERARCHY:
        1. CREATE: New task addition. Extract: 'title', 'status' (default: "To Do"), 'date'.
        2. READ: List/view tasks. 
        3. UPDATE: Change existing task properties. Extract: 'taskId', 'status'.
        4. DELETE: Remove existing task. Extract: 'taskId'.
        5. SUGGEST: Prioritization advice (e.g., "what is urgent?").
        6. UNCLEAR: Use this if the user wants to UPDATE or DELETE, but the task name they provided does NOT have a high-confidence match in the existing tasks list.
        7. OTHER: Only for non-Notion/non-task topics (e.g., "weather", "general knowledge").

        DATE RULES:
        1. ONLY assign a date if the user explicitly mentions one (e.g., "today", "by Friday", "at 3pm").
        2. If the user does NOT mention a time or date (e.g., "Add a task to buy milk"), leave the 'date' field as null or an empty string "".
        3. Do NOT default to ${today} unless the user says "today".
        
        STRICT TIME RULES:
        1. ONLY include a time if the user explicitly mentions one (e.g., "at 3pm", "14:00").
        2. IF NO TIME IS MENTIONED, set the time field to NULL. 
        3. DO NOT DEFAULT TO 12:00, 00:00, or MIDNIGHT.
        4. EXAMPLES (LEARN THE PATTERN):
            - Input: "Submit thesis tomorrow" 
              Output: { "date": "[CALCULATED_TOMORROW_DATE]", "time": null }
  
            - Input: "Call mom at 5pm" 
              Output: { "date": "[CALCULATED_TODAY_DATE]", "time": "17:00" }
        5. DO NOT GUESSTIMATE. If you are unsure about a time, leave it EMPTY.
    
        DATA INTEGRITY & MATCHING RULES:
        1. KEYWORD FOCUS: Match tasks based on their core meaning. Ignore case sensitivity and "filler" words like "a", "the", or "an".
        2. CONFIDENCE THRESHOLD: Only proceed if the user's intent clearly identifies ONE specific task. 
          - "Submit thesis" and "Submit the thesis" = MATCH.
          - "Submit thesis" and "Submit FYP prototype" = NO MATCH.
        3. AMBIGUITY CHECK: If the user's request could apply to multiple different tasks, or if no task shares the core keywords, you MUST return "UNCLEAR".
        4. ID EXTRACTION: When a match is found, always extract the exact 'taskId' from the EXISTING TASKS list.
    
        OUTPUT FORMAT (Strict JSON):
        { 
          "action": "CREATE" | "READ" | "UPDATE" | "DELETE" | "SUGGEST" | "UNCLEAR" | "OTHER", 
          "data": { 
            "taskId": "string (if applicable)", 
            "status": "string (if applicable)", 
            "title": "string (if applicable)", 
            "date": "string (if applicable)",
            "attemptedName": "string (only for UNCLEAR)"
          } 
        }`
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AgentResponse;
}


// Understand status of the task based on user prompt
function normalizeStatus(input?: string): "Not started" | "In Progress" | "Done" {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "done" || s === "completed") return "Done";
  if (s === "in progress" || s === "ongoing") return "In Progress";
  return "Not started";
}


// Function to format ISO strings for a readable date and time
function formatDateAndTime(dateStr: string): string {
  // If it's just a date (YYYY-MM-DD), return it as is
  if (!dateStr.includes('T')) return dateStr;

  try {
    const date = new Date(dateStr);

    // Extract parts for YYYY-MM-DD
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    // Extract time parts for h.mm AM/PM
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12; // Convert 0 to 12

    return `${yyyy}-${mm}-${dd} ${hours}.${minutes}${ampm}`;
  } catch {
    return dateStr; // Fallback to original if parsing fails
  }
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

  let message = "";
  let aiSuggestion;

  if (decision.action === "READ") {
    message = tasks.length > 0
      ? `Here are your current tasks:\n\n` +
      tasks.map(t => {
        // Use the readable date and time format
        const deadline = t.deadline
          ? ` (Due: ${formatDateAndTime(t.deadline)})`
          : " (No deadline)";
        return `• ${t.name} [${t.status}]${deadline}`;
      }).join("\n")
      : "You have no tasks in your list.";
  }
  else if (decision.action === "SUGGEST") {
    // Run the Logic Engine for prioritization advice
    aiSuggestion = await getAgentSuggestion(tasks);
  }
  else if (decision.action === "UNCLEAR") {
    return {
      success: false,
      message: `I couldn't find a task named "${decision.data.attemptedName}". Please check the task name in your list and try again!`,
      actionTaken: decision
    };
  }
  else if (decision.action === "OTHER") {
    return {
      success: true,
      message: "I'm a task assistant, specialized in managing tasks. Ask me something related to managing your tasks.",
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
