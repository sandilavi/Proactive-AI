"use client";

import { useState } from "react";
import { fetchNotionTasks } from "./actions/notion-actions";
import {
  getAgentSuggestion,
  AgentResponse,
  NotionTask,
} from "./actions/agent-actions";

export default function Home() {
  const [tasks, setTasks] = useState<NotionTask[]>([]);
  const [agentResult, setAgentResult] = useState<AgentResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSync = async () => {
    setLoading(true);
    try {
      const fetchedTasks = await fetchNotionTasks();
      setTasks(fetchedTasks);

      const AIResponse = await getAgentSuggestion(fetchedTasks);
      setAgentResult(AIResponse);
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-8 gap-6 bg-gray-50">
      <h1 className="text-4xl font-extrabold text-gray-900">ProActiveAI</h1>

      <button
        onClick={handleSync}
        disabled={loading}
        className="px-8 py-3 bg-indigo-600 text-white rounded-full font-bold hover:bg-indigo-700 disabled:bg-gray-400 shadow-lg transition-all"
      >
        {loading ? "Analyzing..." : "Sync & Get Recommendation"}
      </button>

      {/* Structured Recommendation Section */}
      {agentResult && (
        <div className="w-full max-w-lg p-6 bg-white border border-gray-200 shadow-2xl rounded-2xl">
          <div className="flex justify-between items-center mb-4">
            {/* Dynamic Priority Badge */}
            <span
              className={`text-xs font-black uppercase px-3 py-1 rounded-full border ${
                agentResult.priority === "CRITICAL"
                  ? "bg-red-100 text-red-700 border-red-200"
                  : agentResult.priority === "HIGH"
                  ? "bg-orange-100 text-orange-700 border-orange-200"
                  : agentResult.priority === "MEDIUM"
                  ? "bg-blue-100 text-blue-700 border-blue-200"
                  : "bg-gray-100 text-gray-700 border-gray-200"
              }`}
            >
              {agentResult.priority} Priority
            </span>

            <span className="text-xs font-bold text-gray-400">
              Confidence: {(agentResult.confidence * 100).toFixed(0)}%
            </span>
          </div>

          <div className="mb-4">
            <p className="text-xs text-gray-400 font-bold uppercase mb-1">
              Target Task
            </p>
            <div className="text-xl font-semibold text-gray-900 bg-gray-50 p-3 rounded-lg border border-gray-100">
              🎯 {agentResult.suggestion}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 font-bold uppercase mb-1">
              Reasoning
            </p>
            <p className="text-gray-700 leading-relaxed bg-indigo-50/30 p-3 rounded-lg italic">
              &ldquo;{agentResult.reason}&rdquo;
            </p>
          </div>
        </div>
      )}

      {/* Task List Section */}
      <div className="w-full max-w-md mt-4">
        <h3 className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-widest">
          Notion Inbox ({tasks.length})
        </h3>
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="group p-4 border border-gray-200 rounded-xl bg-white hover:border-indigo-300 hover:shadow-md transition-all flex items-center justify-between"
            >
              <span className="text-gray-700 font-medium">{task.name}</span>
              <div className="h-2 w-2 rounded-full bg-gray-200 group-hover:bg-indigo-400"></div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
