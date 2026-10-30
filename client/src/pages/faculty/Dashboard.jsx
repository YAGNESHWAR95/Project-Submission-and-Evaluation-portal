import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getFacultyReviewSubmissions, getProposalReviewProjects } from '../../services/projectService';
import { formatDate, getStatusBadgeStyle } from '../../utils/formatters';
import EvaluateModal from './EvaluateModal';
import { Search, BookOpen, AlertCircle, RefreshCw, FileEdit } from 'lucide-react';

const REVIEW_LABELS = {
  abstract: 'Review 1 · Proposal and initial project',
  midterm: 'Review 2 · Architecture and design',
  final: 'Review 3 · Final project demonstration',
};

export default function FacultyDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [submissions, setSubmissions] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [filteredRows, setFilteredRows] = useState([]);
  const [activeQueue, setActiveQueue] = useState(() => searchParams.get('queue') === 'proposals' ? 'proposals' : 'submissions');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter States
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');

  // Modal States
  const [selectedReview, setSelectedReview] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchAssignedProjects = async () => {
    try {
      setLoading(true);
      const [submissionData, proposalData] = await Promise.all([
        getFacultyReviewSubmissions(),
        getProposalReviewProjects(),
      ]);
      setSubmissions(submissionData || []);
      setProposals(proposalData || []);
      setError(null);
    } catch (err) {
      console.error('Failed to load faculty reviews:', err);
      setError('Unable to load assigned reviews queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignedProjects();
  }, []);

  useEffect(() => {
    const queue = searchParams.get('queue') === 'proposals' ? 'proposals' : 'submissions';
    setActiveQueue(queue);
    setStatusFilter('');
    setBatchFilter('');
  }, [searchParams]);

  useEffect(() => {
    const projectId = searchParams.get('review');
    if (!projectId) {
      setModalOpen(false);
      setSelectedReview(null);
      return;
    }
    const requestedQueue = searchParams.get('queue') === 'proposals' ? 'proposals' : 'submissions';
    const row = requestedQueue === 'proposals'
      ? (() => {
          const project = proposals.find((item) => String(item._id) === projectId);
          if (!project) return null;
          const proposalStatuses = ['uniqueness_checked', 'faculty_review', 'faculty_changes_requested'];
          return {
            project,
            submission: null,
            proposalOnly: true,
            accessRequestOnly: project.revisionAccessRequest?.status === 'pending'
              && !proposalStatuses.includes(project.status),
          };
        })()
      : (() => {
          const submission = submissions.find((item) => (
            String(item.project?._id) === projectId
            && (!searchParams.get('phase') || item.phase === searchParams.get('phase'))
            && (!searchParams.get('version') || Number(item.version) === Number(searchParams.get('version')))
          ));
          return submission ? { project: submission.project, submission, proposalOnly: false } : null;
        })();

    if (row) {
      setSelectedReview(row);
      setModalOpen(true);
    } else if (!loading) {
      setSelectedReview({ project: null, submission: null, proposalOnly: requestedQueue === 'proposals' });
      setModalOpen(true);
    }
  }, [loading, proposals, searchParams, submissions]);

  // Filter logic
  useEffect(() => {
    const rows = activeQueue === 'submissions'
      ? submissions.map((submission) => ({ project: submission.project, submission, proposalOnly: false }))
      : proposals.map((project) => ({
        project,
        submission: null,
        proposalOnly: true,
        accessRequestOnly: project.revisionAccessRequest?.status === 'pending'
          && !['uniqueness_checked', 'faculty_review', 'faculty_changes_requested'].includes(project.status),
      }));
    let result = rows;

    if (search.trim() !== '') {
      const q = search.toLowerCase();
      result = result.filter(
        ({ project }) =>
          (project.title || '').toLowerCase().includes(q) ||
          (project.teamMembers || []).some((member) => (member?.name || '').toLowerCase().includes(q))
      );
    }

    if (statusFilter !== '') {
      result = result.filter(({ project, submission }) => (submission?.status || project.status) === statusFilter);
    }

    if (batchFilter !== '') {
      result = result.filter(({ project }) => project.deadline?.batch === batchFilter || project.batch === batchFilter);
    }

    setFilteredRows(result);
  }, [search, statusFilter, batchFilter, activeQueue, submissions, proposals]);

  const handleOpenEvaluate = (row) => {
    setSelectedReview(row);
    setModalOpen(true);
    const params = new URLSearchParams({ queue: activeQueue, review: String(row.project?._id || '') });
    if (row.submission) {
      params.set('phase', row.submission.phase);
      params.set('version', String(row.submission.version));
    }
    setSearchParams(params);
  };

  const handleCloseEvaluate = () => {
    setModalOpen(false);
    setSelectedReview(null);
    const params = new URLSearchParams(searchParams);
    params.delete('review');
    params.delete('phase');
    params.delete('version');
    setSearchParams(params, { replace: true });
  };

  // Get distinct batches for filter select options
  const getBatchOptions = () => {
    const rows = activeQueue === 'submissions'
      ? submissions.map((submission) => submission.project)
      : proposals;
    const batches = rows.map((project) => project.deadline?.batch || project.batch).filter(Boolean);
    return [...new Set(batches)];
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-purple-600/10 to-blue-600/10 border-purple-500/10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reviewer Queue</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            Review submitted phase documents and approve proposals in separate queues.
          </p>
        </div>
        <button
          onClick={fetchAssignedProjects}
          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all cursor-pointer text-slate-400"
          title="Refresh Queue"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="Faculty review queues">
        {[
          ['submissions', `Document submissions (${submissions.length})`],
          ['proposals', `Proposal approvals (${proposals.length})`],
        ].map(([queue, label]) => (
          <button
            key={queue}
            type="button"
            role="tab"
            aria-selected={activeQueue === queue}
            onClick={() => { setActiveQueue(queue); setStatusFilter(''); setBatchFilter(''); setSearchParams({ queue }, { replace: true }); }}
            className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeQueue === queue ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-secondary)] hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter and Search Panel */}
      <div className="glass-panel p-4 rounded-2xl grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        {/* Search */}
        <div className="md:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-850 bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Search by project title or student name..."
          />
        </div>

        {/* Status Filter */}
        <div className="md:col-span-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-850 bg-slate-900/40 text-sm focus:outline-none cursor-pointer"
          >
            <option value="">All Statuses</option>
            {(activeQueue === 'submissions'
              ? ['submitted', 'resubmitted', 'changes_requested']
              : ['uniqueness_checked', 'faculty_review', 'faculty_changes_requested'])
              .map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        {/* Batch Filter */}
        <div className="md:col-span-3">
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-850 bg-slate-900/40 text-sm focus:outline-none cursor-pointer"
          >
            <option value="">All Batches</option>
            {getBatchOptions().map(batch => (
              <option key={batch} value={batch}>{batch}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Projects List Queue */}
      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-14 bg-slate-800/40 rounded-xl"></div>
          <div className="h-14 bg-slate-800/40 rounded-xl"></div>
          <div className="h-14 bg-slate-800/40 rounded-xl"></div>
        </div>
      ) : error ? (
        <div className="glass-panel p-6 rounded-2xl border-red-500/25 bg-red-500/5 text-red-400 text-sm flex gap-3 items-center">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : filteredRows.length > 0 ? (
        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-900">
                <tr>
                  <th className="px-6 py-4">Project Details</th>
                  <th className="px-6 py-4">Team Members</th>
                  <th className="px-6 py-4">Batch Cohort</th>
                  <th className="px-6 py-4">Phase / Version</th>
                  <th className="px-6 py-4">Submission Date</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Assigned Reviewer</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-900">
                {filteredRows.map((row) => {
                  const { project: proj, submission, accessRequestOnly } = row;
                  const rowStatus = accessRequestOnly ? 'revision_access_requested' : submission?.status || proj.status;
                  return (
                  <tr key={`${proj._id}-${submission?.phase || (accessRequestOnly ? 'permission-request' : 'proposal')}-${submission?.version || 0}`} className="hover:bg-slate-500/5 transition-colors">
                    <td className="px-6 py-4 max-w-xs">
                      <p className="font-semibold text-white truncate">{proj.title || 'Untitled project'}</p>
                      <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{proj.description || proj.problemStatement || proj.abstract || 'Project details not provided.'}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5 max-w-xs">
                        {(proj.teamMembers || []).map(m => (
                          <span key={m?._id || m} className="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-800 text-slate-300">
                            {m?.name || 'Team member'}
                          </span>
                        ))}
                        {!proj.teamMembers?.length && <span className="text-xs text-slate-500">No team details</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-400">
                      {proj.cohortId || proj.batch || proj.deadline?.batch || proj.leader?.batch || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-300">
                      {submission ? `${REVIEW_LABELS[submission.phase]} · V${submission.version}` : accessRequestOnly ? 'Revision permission request' : 'Proposal approval'}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">
                      {formatDate(submission?.submittedAt || proj.submittedAt)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusBadgeStyle(rowStatus)}`}>
                        {rowStatus.toUpperCase().replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-300">{proj.assignedFaculty?.name || 'Unassigned'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleOpenEvaluate(row)}
                        className="px-3.5 py-1.5 bg-blue-600/10 hover:bg-blue-600 border border-blue-500/25 hover:border-blue-500 text-blue-400 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 ml-auto transition-all cursor-pointer"
                      >
                        <FileEdit className="w-3.5 h-3.5" />
                        {submission ? 'Review' : accessRequestOnly ? 'Respond to request' : 'Review Proposal'}
                      </button>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-12 rounded-2xl text-center space-y-4">
          <div className="w-14 h-14 bg-slate-800 flex items-center justify-center rounded-full mx-auto text-slate-400">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold">{activeQueue === 'submissions' ? 'No Submitted Documents' : 'No Proposals Awaiting Approval'}</h3>
          <p className="text-xs text-[var(--text-secondary)] max-w-xs mx-auto">
            {activeQueue === 'submissions'
              ? 'Projects appear here only after students submit a phase document for faculty review.'
              : 'Proposals awaiting faculty approval appear in this separate queue.'}
          </p>
        </div>
      )}

      {/* Evaluate Modal Component */}
      <EvaluateModal
        key={`${selectedReview?.project?._id || 'unavailable'}-${selectedReview?.proposalOnly ? 'proposal' : selectedReview?.submission?.phase || 'formal'}-${selectedReview?.submission?.version || 0}`}
        isOpen={modalOpen}
        onClose={handleCloseEvaluate}
        project={selectedReview?.project}
        submission={selectedReview?.submission}
        proposalOnly={selectedReview?.proposalOnly}
        accessRequestOnly={selectedReview?.accessRequestOnly}
        onSuccess={fetchAssignedProjects}
      />
    </div>
  );
}
