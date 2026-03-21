import React from 'react';

export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Header Info Skeleton */}
      <div className="flex flex-col gap-2">
        <div className="h-10 w-64 bg-slate-200 rounded-2xl" />
        <div className="h-4 w-96 bg-slate-100 rounded-lg" />
      </div>

      {/* Main Hero Card Skeleton */}
      <div className="h-48 w-full bg-slate-200 rounded-[2.5rem] shadow-sm" />

      {/* Grid Skeletons */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-64 w-full bg-white border border-slate-100 rounded-[2rem] shadow-sm" />
        ))}
      </div>
    </div>
  );
}
