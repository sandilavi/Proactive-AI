"use server";
import { groq } from "@/lib/groq";

export interface NotionTask {
  id: string;
  name: string;
  status?: string;
  deadline?: string;
}

export interface AgentResponse {
  suggestion: string;
  reason: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  confidence: number;
}

export async function getAgentSuggestion(tasks: NotionTask[]): Promise<AgentResponse> {
  const today = new Date().toISOString().split('T')[0];

  // Send the FULL data (name, status, and deadline) to the AI
  const taskContext = tasks.map((t: NotionTask) => 
    `- ${t.name} (Status: ${t.status || 'N/A'}, Deadline: ${t.deadline || 'No Deadline'})`
  ).join("\n");

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
        2. Output MUST be a valid JSON object with: 'suggestion', 'reason', 'priority', and 'confidence' (0-1).`
      },
      { role: "user", content: `Analyze these tasks:\n${taskContext}` }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AgentResponse;
}
