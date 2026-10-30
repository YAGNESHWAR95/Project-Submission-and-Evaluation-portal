import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';

export default function AuthLayout() {
  const { token, user } = useAuth();

  // Redirect authenticated users to dashboard
  if (token && user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-slate-950 text-slate-100 overflow-x-hidden">
      {/* Brand Side Column */}
      <div className="hidden lg:flex lg:col-span-5 relative flex-col justify-between p-12 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.15),transparent_45%)] border-r border-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
            P
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-200 bg-clip-text text-transparent">
            EvalPortal
          </span>
        </div>

        <div className="my-auto space-y-6">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Academic Project Submission & Evaluation Portal
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Collaborate with peers, upload assets directly, track progress milestones, and receive granular evaluation feedback.
          </p>
          <div className="flex gap-4">
            <span className="px-3 py-1 text-xs font-semibold rounded-full border border-blue-500/20 bg-blue-500/10 text-blue-400">Student Hub</span>
            <span className="px-3 py-1 text-xs font-semibold rounded-full border border-purple-500/20 bg-purple-500/10 text-purple-400">Faculty Review</span>
            <span className="px-3 py-1 text-xs font-semibold rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">Admin Control</span>
          </div>
        </div>

        <p className="text-slate-600 text-xs">
          &copy; 2026 Academic Evaluation Portal. All rights reserved.
        </p>
      </div>

      {/* Forms Side Column */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12 md:p-20 bg-[radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.08),transparent_40%)]">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">
              P
            </div>
            <span className="text-lg font-bold">EvalPortal</span>
          </div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
