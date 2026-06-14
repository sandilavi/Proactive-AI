import HorizonView from "../../../components/HorizonView";

export const dynamic = 'force-dynamic';

export default async function HorizonPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <span className="text-xs font-bold uppercase text-slate-400">Horizon Plan</span>
        <h1 className="text-2xl font-bold text-slate-900">
          Focus Horizon
        </h1>
        <p className="text-xs text-slate-500">Break down project goals into a daily actionable roadmap.</p>
      </div>

      <HorizonView />
    </div>
  );
}
