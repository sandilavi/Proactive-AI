"use client";
import React from 'react';
import Sidebar from '@/components/Sidebar';
import DashboardHeader from '@/components/DashboardHeader';
import AgentEngine from '@/components/AgentEngine';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
   return (
    <div className="flex h-screen bg-[#fcfcfd] relative overflow-hidden">
      {/* Global Background Intelligence Engine */}
      <AgentEngine />
       {/* Premium Background Elements */}
       <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0">
          <div className="absolute top-[-15%] left-[-15%] w-[50%] h-[50%] bg-blue-200/20 rounded-full blur-[160px] animate-pulse duration-[10s]"></div>
          <div className="absolute bottom-[-15%] right-[-15%] w-[50%] h-[50%] bg-indigo-200/20 rounded-full blur-[160px] animate-pulse duration-[12s]"></div>
          <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-rose-100/10 rounded-full blur-[120px]"></div>
       </div>

      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto relative z-10">
          <div className="max-w-6xl mx-auto px-12 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
