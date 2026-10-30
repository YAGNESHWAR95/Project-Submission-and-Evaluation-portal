import React, { useEffect, useState } from 'react';
import { getDeadlines, createDeadline, updateDeadline } from '../../services/adminService';
import { formatDate } from '../../utils/formatters';
import { Calendar, Plus, Loader2, AlertCircle, Pencil, Archive, RotateCcw } from 'lucide-react';

const REVIEW_PHASE_LABELS = {
  abstract: 'Review 1 · Abstract',
  midterm: 'Review 2 · Midterm',
  final: 'Review 3 · Final',
};

export default function ManageDeadlines() {
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form states
  const [formOpen, setFormOpen] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(null);
  const [batch, setBatch] = useState('Batch 2026');
  const [phase, setPhase] = useState('final');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusActionId, setStatusActionId] = useState(null);
  const [formError, setFormError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  const fetchDeadlinesList = async () => {
    try {
      setLoading(true);
      const data = await getDeadlines();
      setDeadlines(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load deadlines:', err);
      setError('Unable to fetch timelines registry list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeadlinesList();
  }, []);

  const toDateTimeLocal = (date) => {
    const value = new Date(date);
    return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const openCreateForm = () => {
    setEditingDeadline(null);
    setBatch('Batch 2026');
    setPhase('final');
    setTitle('');
    setStartDate('');
    setEndDate('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEditForm = (deadline) => {
    setEditingDeadline(deadline);
    setBatch(deadline.batch || '');
    setPhase(deadline.phase || 'final');
    setTitle(deadline.title || '');
    setStartDate(toDateTimeLocal(deadline.submissionStartDate));
    setEndDate(toDateTimeLocal(deadline.submissionEndDate));
    setFormError(null);
    setFormOpen(true);
  };

  const handleSaveDeadline = async (e) => {
    e.preventDefault();
    setFormError(null);

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      return setFormError('Start date must be earlier than the end date.');
    }

    setSubmitting(true);
    try {
      const deadlineData = {
        batch,
        phase,
        title,
        submissionStartDate: startDate,
        submissionEndDate: endDate,
      };
      if (editingDeadline) {
        await updateDeadline(editingDeadline._id, { ...deadlineData, isActive: editingDeadline.isActive });
      } else {
        await createDeadline(deadlineData);
      }

      setFormOpen(false);
      setEditingDeadline(null);
      setTitle('');
      setStartDate('');
      setEndDate('');
      await fetchDeadlinesList();
      setActionError(null);
      setActionSuccess(editingDeadline ? 'Deadline updated.' : 'Deadline created and activated.');
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to save submission deadline.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleDeadline = async (deadline) => {
    const nextIsActive = !deadline.isActive;
    setStatusActionId(deadline._id);
    setActionError(null);
    setActionSuccess(null);
    try {
      await updateDeadline(deadline._id, {
        batch: deadline.batch,
        phase: deadline.phase || 'final',
        title: deadline.title,
        submissionStartDate: deadline.submissionStartDate,
        submissionEndDate: deadline.submissionEndDate,
        isActive: nextIsActive,
      });
      await fetchDeadlinesList();
      setActionSuccess(nextIsActive ? 'Deadline reopened.' : 'Deadline deactivated.');
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to update deadline state.');
    } finally {
      setStatusActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Submission Windows</h1>
          <p className="text-[var(--text-secondary)] text-sm">Schedule locks and upload constraints per student cohorts.</p>
        </div>
        <button
          onClick={openCreateForm}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-blue-500/10"
        >
          <Plus className="w-4 h-4" />
          Schedule Deadline
        </button>
      </div>

      {actionError && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm" role="alert">{actionError}</div>}
      {actionSuccess && <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm" role="status">{actionSuccess}</div>}

      {/* Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleSaveDeadline} role="dialog" aria-modal="true" aria-labelledby="deadline-form-title" className="w-full max-w-md glass-panel-glow p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 animate-in fade-in zoom-in-95 duration-200 space-y-4">
            <h3 id="deadline-form-title" className="text-base font-bold">{editingDeadline ? 'Edit Submission Window' : 'Configure Submission Window'}</h3>

            {formError && (
              <div className="p-3 text-xs rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex gap-2 items-center">
                <AlertCircle className="w-4 h-4" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Target Student Cohort (Batch)</label>
              <input
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Deadline Name</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none"
                placeholder="e.g. Abstract Submission Window"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Evaluation Phase</label>
              <select
                value={phase}
                onChange={(event) => setPhase(event.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
              >
                <option value="abstract">Review 1 · Abstract</option>
                <option value="midterm">Review 2 · Midterm</option>
                <option value="final">Review 3 · Final</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Open Window Date</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Closing Cutoff Date</label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setFormOpen(false); setEditingDeadline(null); setFormError(null); }}
                disabled={submitting}
                className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold cursor-pointer text-slate-400 hover:bg-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editingDeadline ? 'Save Changes' : 'Schedule'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Deadlines list */}
      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-12 bg-slate-800/40 rounded-xl"></div>
          <div className="h-12 bg-slate-800/40 rounded-xl"></div>
        </div>
      ) : deadlines.length > 0 ? (
        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-900">
                <tr>
                  <th className="px-6 py-4">Timeline Description</th>
                  <th className="px-6 py-4">Cohort (Batch)</th>
                  <th className="px-6 py-4">Phase</th>
                  <th className="px-6 py-4">Submission Start</th>
                  <th className="px-6 py-4">Submission Cutoff</th>
                  <th className="px-6 py-4">State</th>
                  <th className="px-6 py-4">Updated</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-900">
                {deadlines.map(d => (
                  <tr key={d._id} className="hover:bg-slate-500/5 transition-colors">
                    <td className="px-6 py-4 font-semibold text-white">
                      <div className="flex items-center gap-3">
                        <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                        <div>
                          <span>{d.title}</span>
                          {((/abstract|proposal|initial/i.test(d.title || '') && (d.phase || 'final') !== 'abstract')
                            || (/midterm|architecture|design/i.test(d.title || '') && (d.phase || 'final') !== 'midterm')
                            || (/final|demonstration|demo/i.test(d.title || '') && (d.phase || 'final') !== 'final')) && (
                            <p className="mt-1 text-xs font-normal text-amber-300">Title and configured phase differ. Edit this existing window to correct its phase.</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-400">{d.batch}</td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-400">{REVIEW_PHASE_LABELS[d.phase || 'final'] || 'Review phase not recognized'}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">{formatDate(d.submissionStartDate)}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">{formatDate(d.submissionEndDate)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        d.isActive && new Date(d.submissionEndDate) > new Date()
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : d.isActive
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}>
                        {!d.isActive ? 'INACTIVE' : new Date(d.submissionEndDate) <= new Date() ? 'EXPIRED' : 'ACTIVE'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{d.updatedAt ? formatDate(d.updatedAt) : 'Not recorded'}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openEditForm(d)} className="flex items-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800" title="Edit or reschedule deadline" aria-label={`Edit ${d.title}`}>
                          <Pencil className="h-4 w-4" />
                          <span>Edit</span>
                        </button>
                        {d.isActive ? (
                          <button type="button" onClick={() => handleToggleDeadline(d)} disabled={statusActionId === d._id} className="rounded-md border border-slate-700 p-2 text-amber-300 hover:bg-slate-800 disabled:opacity-50" title="Deactivate or archive deadline" aria-label={`Deactivate ${d.title}`}>
                            {statusActionId === d._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                          </button>
                        ) : (
                          <button type="button" onClick={() => handleToggleDeadline(d)} disabled={statusActionId === d._id || new Date(d.submissionEndDate) <= new Date()} className="rounded-md border border-slate-700 p-2 text-emerald-300 hover:bg-slate-800 disabled:opacity-50" title={new Date(d.submissionEndDate) <= new Date() ? 'Reschedule the cutoff to a future date before reopening' : 'Reopen deadline'} aria-label={`Reopen ${d.title}`}>
                            {statusActionId === d._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-8 text-center text-slate-400">No scheduled submission timelines found.</div>
      )}
    </div>
  );
}
