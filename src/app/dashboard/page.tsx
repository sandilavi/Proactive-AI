import CommandInput from "@/components/CommandInput";
import { fetchNotionTasks, discoverDatabases } from "@/app/actions/notion-actions";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [databases, initialTasks] = await Promise.all([
    discoverDatabases(),
    fetchNotionTasks()
  ]);

  return (
     <div className="space-y-6 pb-20">
       {/* Header Info: High-End Cinematic Greeting */}
       <div className="flex flex-col gap-1">
         <div className="flex items-center gap-3">
            <div className="w-10 h-[2px] bg-blue-500 rounded-full"></div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Operational Dashboard</span>
         </div>
         <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-tight">
           Welcome back.
         </h1>
         <div className="text-sm font-bold text-slate-400/80 tracking-tight flex items-center gap-2 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            All systems nominal. Neural synchronization with Notion active.
         </div>
       </div>

      <CommandInput 
        initialTasks={initialTasks} 
        databases={databases} 
      />
    </div>
  );
}
