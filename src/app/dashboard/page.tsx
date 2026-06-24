import CommandInput from "@/components/CommandInput";
import { fetchNotionTasks, discoverDatabases } from "@/app/actions/notion-actions";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [databases, initialTasks] = await Promise.all([
    discoverDatabases(),
    fetchNotionTasks()
  ]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header Info */}
      <div className="space-y-1">
        <span className="text-xs font-bold uppercase text-slate-400">Dashboard</span>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome Back
        </h1>
        <p className="text-xs text-slate-500">
          Connected to Notion workspace.
        </p>
      </div>

      <CommandInput 
        initialTasks={initialTasks} 
        databases={databases} 
      />
    </div>
  );
}
