"use client";

import { fetchNotionTasks } from "./actions/notion-actions";

export default function Home() {
  const handleSync = async () => {
    console.log("Syncing with Notion...");
    const tasks = await fetchNotionTasks();
    console.log("Tasks received in UI:", tasks);
    alert(`Fetched ${tasks.length} tasks. Check the console for details.`);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">ProActiveAI Control Panel</h1>
      <button
        onClick={handleSync}
        className="rounded-full bg-blue-600 px-5 py-3 text-white shadow hover:bg-blue-700 transition"
      >
        Sync Notion Tasks
      </button>
    </main>
  );
}
