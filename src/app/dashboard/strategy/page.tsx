import { fetchNotionTasks } from "@/app/actions/notion-actions";
import { getCapacityInsights } from "@/app/actions/strategy-actions";
import StrategyView from "@/components/StrategyView";

export const dynamic = 'force-dynamic';

export default async function StrategyPage() {
  const tasks = await fetchNotionTasks();
  const report = await getCapacityInsights(tasks, "+00:00");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <span className="text-xs font-bold uppercase text-slate-400">Cognitive Load Assessment</span>
        <h1 className="text-2xl font-bold text-slate-900">
          Strategic Intelligence
        </h1>
        <p className="text-xs text-slate-500">Analyze capacity limits and workload slots for upcoming cycles.</p>
      </div>

      <StrategyView tasks={tasks} initialReport={report} />
    </div>
  );
}
