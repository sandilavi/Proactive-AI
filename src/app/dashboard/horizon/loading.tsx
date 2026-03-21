import React from 'react';

export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Header Info Skeleton */}
      <div className="flex flex-col gap-2">
        <div className="h-10 w-64 bg-slate-200 rounded-2xl" />
        <div className="h-4 w-96 bg-slate-100 rounded-lg" />
      </div>

      {/* Main Input Area Skeleton */}
      <div className="h-48 w-full bg-slate-200 rounded-[2.5rem] shadow-sm" />
    </div>
  );
}
