import CommandInput from "@/components/CommandInput";
import { fetchNotionTasks } from "@/app/actions/notion-actions";

export const dynamic = 'force-dynamic';

export default async function Page() {
  const initialTasks = await fetchNotionTasks();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-200 pt-8 pb-12 px-4">
      <div className="max-w-2xl mx-auto">
        
        <div className="text-center mb-8">
          <img src="/icon.png" alt="ProActiveAI" className="h-12 w-12 mx-auto mb-3" />
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
            ProActive<span className="text-blue-600">AI</span>
          </h1>
          <p className="text-slate-500 font-medium">Your Intelligent Notion Task Agent</p>
        </div>

        <CommandInput initialTasks={initialTasks} />

      </div>
    </main>
  );
}
