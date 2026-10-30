import React, { useState } from 'react';
import { Link, useNavigate, useLocation, Outlet } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import {
  LayoutDashboard,
  UploadCloud,
  Users,
  Calendar,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
  FileCheck,
  UserRoundCheck,
  BookOpen,
  MessageSquare,
  Bell,
  Mail,
  Award,
} from 'lucide-react';

export default function DashboardLayout() {
  const { user, logoutUser, isStudent, isFaculty, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  const getNavigationLinks = () => {
    const links = [];
    if (isStudent) {
      if (location.pathname === '/submit') {
        return [
          { path: '/', search: '?section=overview', label: 'Overview', icon: LayoutDashboard },
          { path: '/submit', search: '?step=1', label: 'Basic Info', icon: FileCheck },
          { path: '/submit', search: '?step=2', label: 'Team', icon: Users },
          { path: '/submit', search: '?step=3', label: 'Guide', icon: Award },
          { path: '/submit', search: '?step=4', label: 'Project Details', icon: BookOpen },
          { path: '/submit', search: '?step=5', label: 'Reviews', icon: FileCheck },
          { path: '/', search: '?section=workspace', label: 'Project Workspace', icon: MessageSquare },
          { path: '/', search: '?section=invitations', label: 'Invitations', icon: Mail },
          { path: '/', search: '?section=notifications', label: 'Notifications', icon: Bell },
          { path: '/', search: '?section=complaints', label: 'Complaints', icon: MessageSquare },
          { path: '/submit', label: 'Submit Project', icon: UploadCloud },
        ];
      }
      links.push(
        { path: '/', search: '?section=overview', label: 'Overview', icon: LayoutDashboard },
        { path: '/', search: '?section=basicInfo', label: 'Basic Info', icon: FileCheck },
        { path: '/', search: '?section=team', label: 'Team', icon: Users },
        { path: '/', search: '?section=guide', label: 'Guide', icon: Award },
        { path: '/', search: '?section=projectDetails', label: 'Project Details', icon: BookOpen },
        { path: '/submit', search: '?step=5', label: 'Reviews', icon: FileCheck },
        { path: '/', search: '?section=workspace', label: 'Project Workspace', icon: MessageSquare },
        { path: '/', search: '?section=invitations', label: 'Invitations', icon: Mail },
        { path: '/', search: '?section=notifications', label: 'Notifications', icon: Bell },
        { path: '/', search: '?section=complaints', label: 'Complaints', icon: MessageSquare },
        { path: '/submit', label: 'Submit Project', icon: UploadCloud }
      );
    } else if (isFaculty) {
      links.push(
        { path: '/', search: '?queue=submissions', label: 'Formal Reviews', icon: FileCheck },
        { path: '/', search: '?queue=proposals', label: 'Proposal Reviews', icon: BookOpen },
        { path: '/notifications', label: 'Notifications', icon: Bell }
      );
    } else if (isAdmin) {
      links.push(
        { path: '/', label: 'System Analytics', icon: LayoutDashboard },
        { path: '/faculty-assignment', label: 'Faculty Assignment', icon: UserRoundCheck },
        { path: '/users', label: 'Manage Users', icon: Users },
        { path: '/deadlines', label: 'Manage Deadlines', icon: Calendar },
        { path: '/notifications', label: 'Notifications', icon: Bell }
      );
    }
    return links;
  };

  const navigation = getNavigationLinks();
  const getNavigationSearch = (item) => {
    const params = new URLSearchParams(item.search || '');
    const currentParams = new URLSearchParams(location.search);
    if (item.path === '/submit' && params.has('step') && currentParams.get('mode')) {
      params.set('mode', currentParams.get('mode'));
    }
    const search = params.toString();
    return search ? `?${search}` : '';
  };
  const isNavigationActive = (item) => {
    if (location.pathname !== item.path) return false;
    if (!item.search) {
      return item.path !== '/submit' || !new URLSearchParams(location.search).has('step');
    }
    const targetParams = new URLSearchParams(item.search);
    const currentParams = new URLSearchParams(location.search);
    return [...targetParams.entries()].every(([key, value]) => (
      currentParams.get(key) === value
      || (!currentParams.has(key) && (
        (key === 'section' && value === 'overview')
        || (key === 'queue' && value === 'submissions')
      ))
    ));
  };

  return (
    <div className="min-h-screen flex bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Desktop Sidebar (Left Panel) */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-72 md:flex-col glass-panel border-r border-slate-200 dark:border-slate-900 shrink-0">
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-900">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md">
              P
            </div>
            <span className="font-bold tracking-tight text-lg bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
              EvalPortal
            </span>
          </div>
        </div>

        {/* Sidebar Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = isNavigationActive(item);
            return (
              <Link
                key={`${item.path}${item.search || ''}`}
                to={{ pathname: item.path, search: getNavigationSearch(item) }}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/10'
                    : 'text-[var(--text-secondary)] hover:bg-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer Area */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-900">
          <button
            onClick={handleLogout}
            className="flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-red-500 hover:bg-red-500/5 hover:text-red-400 rounded-xl transition-all"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            Logout Session
          </button>
        </div>
      </aside>

      {/* Mobile Drawer (Overlay) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden bg-black/50 backdrop-blur-sm">
          <div className="w-64 glass-panel flex flex-col h-full animate-in slide-in-from-left duration-200">
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-900">
              <span className="font-bold">EvalPortal</span>
              <button onClick={() => setMobileOpen(false)} className="p-1 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = isNavigationActive(item);
                return (
                  <Link
                    key={`${item.path}${item.search || ''}`}
                    to={{ pathname: item.path, search: getNavigationSearch(item) }}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-[var(--text-secondary)] hover:bg-slate-100 dark:hover:bg-slate-900'
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-900">
              <button
                onClick={handleLogout}
                className="flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-red-500 rounded-xl transition-all"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-900 glass-panel shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1 rounded-lg md:hidden hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="hidden md:block">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              Welcome back, <strong className="text-[var(--text-primary)]">{user?.name}</strong>
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-900 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all"
              aria-label="Toggle Theme"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 text-slate-700" />
              ) : (
                <Sun className="w-4 h-4 text-yellow-400" />
              )}
            </button>

            {/* Profile indicator */}
            <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-900">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold">{user?.name}</p>
                <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider font-bold">
                  {user?.role}
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center font-bold text-blue-500 select-none">
                {user?.name?.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Content Panel Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          <div className="w-full min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
