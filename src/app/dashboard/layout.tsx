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
         <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-50/50 rounded-full blur-[120px]"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-50/50 rounded-full blur-[120px]"></div>
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
