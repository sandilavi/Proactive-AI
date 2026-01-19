"use server";
import { groq } from "@/lib/groq";

interface Task {
  id: string;
  name: string;
}

export async function getAgentSuggestion(tasks: Task[]) {
  const taskPrompt = tasks.map(t => `- ${t.name}`).join("\n");

  const response = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are a project agent. Suggest one task to focus on from the list and give a short, mean reason why."
      },
      { role: "user", content: `My tasks:\n${taskPrompt}` }
    ],
    model: "llama-3.3-70b-versatile",
  });

  return response.choices[0].message.content;
}
