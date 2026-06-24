import React from 'react';

export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Header Skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-32 bg-slate-200 rounded" />
        <div className="h-8 w-48 bg-slate-200 rounded" />
        <div className="h-4 w-64 bg-slate-100 rounded" />
      </div>

      {/* Main Content Area Skeleton */}
      <div className="space-y-6">
        <div className="flex gap-2">
          <div className="h-6 w-20 bg-slate-100 rounded" />
          <div className="h-6 w-24 bg-slate-100 rounded" />
        </div>

        {/* Command Input Skeleton */}
        <div className="h-48 w-full bg-white border border-slate-200 rounded-lg" />
        
        {/* Table Skeleton */}
        <div className="space-y-3">
           <div className="h-5 w-24 bg-slate-100 rounded" />
           <div className="h-64 w-full bg-white border border-slate-200 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
