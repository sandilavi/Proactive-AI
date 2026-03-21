import React from 'react';

export default function Loading() {
  return (
    <div className="space-y-12 animate-pulse">
      {/* Header Info Skeleton */}
      <div className="flex flex-col gap-2">
        <div className="h-10 w-64 bg-slate-200 rounded-2xl" />
        <div className="h-4 w-80 bg-slate-100 rounded-lg" />
      </div>

      {/* Main Content Area Skeleton */}
      <div className="space-y-6">
        {/* Source Badges Skeleton */}
        <div className="flex gap-2">
          <div className="h-8 w-24 bg-slate-100 rounded-full" />
          <div className="h-8 w-32 bg-slate-100 rounded-full" />
        </div>

        {/* Command Input Skeleton */}
        <div className="h-64 w-full bg-white/70 border border-slate-100 rounded-[2.5rem] shadow-sm" />
        
        {/* Table Skeleton */}
        <div className="mt-12 space-y-4">
           <div className="h-6 w-32 bg-slate-100 rounded-lg" />
           <div className="h-96 w-full bg-white border border-slate-50 rounded-[2rem] shadow-sm" />
        </div>
      </div>
    </div>
  );
}
