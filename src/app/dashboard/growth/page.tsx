import { discoverDatabases, fetchNotionTasks } from "@/app/actions/notion-actions";
import GrowthView from "../../../components/GrowthView";

export const dynamic = 'force-dynamic';

export default async function GrowthPage() {
  const [databases, tasks] = await Promise.all([
    discoverDatabases(),
    fetchNotionTasks()
  ]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">
          The <span className="text-emerald-600">Growth Lab</span>
        </h1>
        <p className="text-sm font-medium text-slate-400">Track your skills, level up your expertise, and watch your progress grow.</p>
      </div>

      <GrowthView tasks={tasks} />
    </div>
  );
}
