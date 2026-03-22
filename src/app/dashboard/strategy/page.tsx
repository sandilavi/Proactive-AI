import { fetchNotionTasks } from "@/app/actions/notion-actions";
import { getCapacityInsights } from "@/app/actions/agent-actions";
import StrategyView from "@/components/StrategyView";

export const dynamic = 'force-dynamic';

export default async function StrategyPage() {
  const tasks = await fetchNotionTasks();
  
  // Pre-fetch insights on the server to prevent loading flicker
  // We use a default offset for the server-side pre-render; 
  // the client will refresh if the timezone is different.
  const report = await getCapacityInsights(tasks, "+00:00");

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">
          Strategic <span className="text-purple-600">Intelligence</span>
        </h1>
        <p className="text-sm font-medium text-slate-400">Analysis of your capacity and cognitive load for the upcoming week.</p>
      </div>

      <StrategyView tasks={tasks} initialReport={report} />
    </div>
  );
}
