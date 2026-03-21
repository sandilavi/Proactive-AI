import { discoverDatabases, fetchNotionTasks } from "@/app/actions/notion-actions";
import PulseView from "../../../components/PulseView";

export const dynamic = 'force-dynamic';

export default async function PulsePage() {
  const [databases, tasks] = await Promise.all([
    discoverDatabases(),
    fetchNotionTasks()
  ]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">
          Productivity <span className="text-rose-600">Pulse</span>
        </h1>
        <p className="text-sm font-medium text-slate-400">Predictive analytics and behavioral trends based on your work history.</p>
      </div>

      <PulseView tasks={tasks} />
    </div>
  );
}
