import React, { useEffect, useState } from 'react';
import { AlertCircle, Bell, CheckCheck, Loader2, Trash2 } from 'lucide-react';
import { clearMyNotifications, getMyNotifications, markAllAsRead, markAsRead } from '../services/notificationService';
import { formatDate } from '../utils/formatters';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getMyNotifications();
      setNotifications(result.notifications || []);
      setUnreadCount(result.unreadCount || 0);
    } catch {
      setError('Unable to load notifications. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const handleMarkRead = async (id) => {
    setError('');
    try {
      await markAsRead(id);
      setNotifications((current) => current.map((item) => item._id === id ? { ...item, isRead: true } : item));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      setError('Unable to mark this notification as read. Please try again.');
    }
  };

  const handleMarkAllRead = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await markAllAsRead();
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
      setMessage('All notifications are marked as read.');
    } catch {
      setError('Unable to mark notifications as read. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!notifications.length || !window.confirm('Clear all notifications for your account? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await clearMyNotifications();
      setNotifications([]);
      setUnreadCount(0);
      setMessage('All notifications were cleared.');
    } catch {
      setError('Unable to clear notifications. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold"><Bell className="h-6 w-6 text-pink-500" />Notifications</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{unreadCount} unread</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 && (
            <button type="button" onClick={handleMarkAllRead} disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700">
              <CheckCheck className="h-4 w-4" />Mark all as read
            </button>
          )}
          {notifications.length > 0 && (
            <button type="button" onClick={handleClearAll} disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-pink-500/40 px-3 py-2 text-sm font-semibold text-pink-600 hover:bg-pink-500/10 disabled:opacity-50 dark:text-pink-300">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Clear all
            </button>
          )}
        </div>
      </header>

      {error && <p role="alert" className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
      {message && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-300">{message}</p>}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center text-[var(--text-secondary)]"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : notifications.length ? (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {notifications.map((notification) => (
            <article key={notification._id} className={`flex items-start justify-between gap-4 py-5 ${notification.isRead ? 'opacity-75' : ''}`}>
              <div className="min-w-0">
                <h2 className="font-semibold">{notification.title}</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{notification.message}</p>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">{formatDate(notification.createdAt)}</p>
              </div>
              {!notification.isRead && (
                <button type="button" onClick={() => handleMarkRead(notification._id)} disabled={busy} className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-slate-700">
                  Mark as read
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="glass-panel flex min-h-48 flex-col items-center justify-center rounded-lg p-8 text-center">
          <Bell className="h-7 w-7 text-[var(--text-secondary)]" />
          <h2 className="mt-3 font-semibold">No notifications</h2>
        </div>
      )}
    </div>
  );
}