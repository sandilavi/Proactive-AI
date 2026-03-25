import HorizonView from "../../../components/HorizonView";

export const dynamic = 'force-dynamic';

export default async function HorizonPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">
          Focus <span className="text-indigo-600">Horizon</span>
        </h1>
        <p className="text-sm font-medium text-slate-400">Instantly break down high-level project goals into an actionable roadmap.</p>
      </div>

      <HorizonView />
    </div>
  );
}
