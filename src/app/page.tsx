"use client";

import { useState } from "react";
import { fetchNotionTasks } from "./actions/notion-actions";
import { getAgentSuggestion } from "./actions/agent-actions";

interface Task {
  id: string;
  name: string;
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSync = async () => {
    setLoading(true);
    try {
      const fetchedTasks = await fetchNotionTasks();
      setTasks(fetchedTasks);

      const AIResponse = await getAgentSuggestion(fetchedTasks);
      setSuggestion(AIResponse);
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-4">
      <h1 className="text-2xl font-bold">ProActiveAI</h1>

      <button onClick={handleSync} disabled={loading} className="...">
        {loading ? "Thinking..." : "Sync Tasks"}
      </button>

      {suggestion && (
        <div className="mt-4 p-4 bg-gray-100 border-l-4 border-red-500 max-w-md">
          <p className="italic">&ldquo;{suggestion}&rdquo;</p>
        </div>
      )}

      <ul className="mt-6 w-full max-w-md space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="p-2 border rounded bg-white shadow-sm">
            {task.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
