import React, { useEffect, useState } from 'react';
import { getStats, downloadExportReport, getUsers } from '../../services/adminService';
import { getProjects, assignFacultyToProject } from '../../services/projectService';
import { getAllComplaints, updateComplaintStatus } from '../../services/complaintService';
import { formatDate, getStatusBadgeStyle } from '../../utils/formatters';
import { getSimilarityDisplayState } from '../../utils/similarityDisplay';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts';
import {
  Users,
  Award,
  FolderGit2,
  Download,
  Loader2,
  UserCheck,
  Check,
  AlertCircle,
  MessageSquare,
  ShieldAlert,
  Send,
  Clock3,
  FileCheck,
} from 'lucide-react';

const ASSIGNMENT_READY_STATUSES = new Set(['uniqueness_checked', 'submitted']);
const ACTIVE_ASSIGNMENT_STATUSES = new Set([
  'faculty_review',
  'faculty_accepted',
  'faculty_changes_requested',
  'under_review',
  'revision_required',
  'resubmitted',
]);

function MetricCard({ label, value, icon, accent }) {
  const accentClasses = {
    blue: 'text-blue-500',
    amber: 'text-amber-500',
    emerald: 'text-emerald-500',
    purple: 'text-purple-500',
    cyan: 'text-cyan-500',
    indigo: 'text-indigo-500',
  };

  return (
    <div className="glass-panel p-6 rounded-2xl space-y-2">
      <div className="flex justify-between items-center text-slate-500">
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
        <span className={accentClasses[accent] || accentClasses.blue}>{icon}</span>
      </div>
      <p className="text-3xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [facultyList, setFacultyList] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [complaintsError, setComplaintsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [selectedFaculty, setSelectedFaculty] = useState({});
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Complaint response state
  const [respondingId, setRespondingId] = useState(null);
  const [responseText, setResponseText] = useState({});
  const [updatingComplaintId, setUpdatingComplaintId] = useState(null);
  const [complaintErrors, setComplaintErrors] = useState({});

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const complaintsRequest = getAllComplaints()
        .then((data) => { setComplaints(data || []); setComplaintsError(''); })
        .catch(() => { setComplaints([]); setComplaintsError('Unable to load complaints. Use refresh to try again.'); });
      const [statsData, projectsData, usersData] = await Promise.all([
        getStats(),
        getProjects(),
        getUsers(),
        complaintsRequest,
      ]);
      setStats(statsData);
      setProjects(projectsData || []);
      setFacultyList(usersData?.filter(u => u.role === 'faculty') || []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError('Failed to fetch system metrics and project data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleAssignReviewer = async (projectId) => {
    const facultyId = selectedFaculty[projectId];
    if (!facultyId) return;

    setAssigningId(projectId);
    setActionSuccess(null);
    setActionError(null);
    try {
      await assignFacultyToProject(projectId, facultyId);
      setActionSuccess(`Reviewer assigned successfully for project!`);
      setTimeout(() => setActionSuccess(null), 3000);
      const [updatedProjects, updatedStats] = await Promise.all([
        getProjects(),
        getStats(),
      ]);
      setProjects(updatedProjects);
      setStats(updatedStats);
    } catch (err) {
      console.error('Failed to assign reviewer:', err);
      setActionError(err.response?.data?.message || 'Failed to assign reviewer');
    } finally {
      setAssigningId(null);
    }
  };

  const handleUpdateComplaint = async (complaintId, newStatus) => {
    setUpdatingComplaintId(complaintId);
    setComplaintErrors((current) => ({ ...current, [complaintId]: '' }));
    try {
      const updated = await updateComplaintStatus(complaintId, {
        status: newStatus,
        adminResponse: responseText[complaintId] || '',
      });
      setComplaints(prev => prev.map(c => c._id === complaintId ? updated : c));
      setRespondingId(null);
      setActionSuccess(`Complaint status updated to ${newStatus.toUpperCase()}`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to update complaint:', err);
      setComplaintErrors((current) => ({
        ...current,
        [complaintId]: err.response?.data?.message || 'Unable to update this complaint. Please try again.',
      }));
    } finally {
      setUpdatingComplaintId(null);
    }
  };

  const COLORS = ['#eab308', '#f97316', 'var(--chart-teal)', '#10b981', 'var(--chart-pink)'];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-8 text-center" role="alert">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="font-semibold">{error}</p>
        <button onClick={fetchDashboardData} className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">
          Retry
        </button>
      </div>
    );
  }

  const { summary, statusStats, deptStats } = stats || {};
  const getReferenceId = (reference) => {
    if (typeof reference === 'string') return reference;
    const id = reference?._id || reference?.id;
    return id === undefined || id === null ? '' : String(id);
  };
  const getReferenceName = (reference, fallback) => (
    reference && typeof reference === 'object' && typeof reference.name === 'string' && reference.name.trim()
      ? reference.name
      : fallback
  );
  const getProjectDepartment = (proj) => (
    (typeof proj?.department === 'string' && proj.department.trim())
    || (typeof proj?.leader?.department === 'string' && proj.leader.department.trim())
    || 'Department not available'
  );
  const getProjectCohort = (proj) => {
    const leader = proj?.leader && typeof proj.leader === 'object' ? proj.leader : {};
    const deadline = proj?.deadline && typeof proj.deadline === 'object' ? proj.deadline : {};
    const cohort = proj?.cohortId || proj?.cohort;
    const batch = proj?.batch || deadline.batch || leader.batch;
    const section = proj?.section || leader.section;
    const academicYear = proj?.academicYear || leader.academicYear;
    const parts = [
      cohort,
      batch && `Batch ${batch}`,
      section && `Section ${section}`,
      academicYear && `AY ${academicYear}`,
    ].filter(Boolean);
    return [...new Map(parts.map((part) => [String(part).trim().toLowerCase(), String(part).trim()])).values()]
      .join(' · ') || 'Cohort not available';
  };
  const getProjectTeamSummary = (proj) => {
    const leaderId = getReferenceId(proj?.leader);
    const additionalMembers = (Array.isArray(proj?.teamMembers) ? proj.teamMembers : [])
      .filter((member) => !leaderId || getReferenceId(member) !== leaderId)
      .map((member) => getReferenceName(member, 'Unnamed member'));
    return additionalMembers.length ? `Accepted members: ${additionalMembers.join(', ')}` : 'No additional members';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-blue-600/10 to-emerald-600/10 border-blue-500/10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Analytics & Administration</h1>
          <p className="text-[var(--text-secondary)] text-sm">Monitor submission volumes, grading velocities, reviewer allocations, and complaints.</p>
        </div>
        <button
          onClick={async () => {
            setExporting(true);
            try {
              await downloadExportReport();
            } catch (err) {
              console.error('Export failed:', err);
              setActionError('Unable to export the evaluation report. Please try again.');
            } finally {
              setExporting(false);
            }
          }}
          disabled={exporting}
          className="px-4 py-2.5 bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export CSV Evaluation Sheet
        </button>
      </div>

      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex gap-3 items-center">
          <Check className="w-5 h-5 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex gap-3 items-center" role="alert">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Total Projects"
          value={summary?.totalProjects ?? projects.length}
          icon={<FolderGit2 className="w-5 h-5 text-blue-500" />}
          accent="blue"
        />
        <MetricCard
          label="Proposals & Drafts"
          value={summary?.proposalProjects ?? 0}
          icon={<FolderGit2 className="w-5 h-5 text-amber-500" />}
          accent="amber"
        />
        <MetricCard
          label="Awaiting Faculty Assignment"
          value={summary?.awaitingFacultyAssignment ?? 0}
          icon={<Clock3 className="w-5 h-5 text-amber-500" />}
          accent="amber"
        />
        <MetricCard
          label="Assigned Projects"
          value={summary?.assignedProjects ?? 0}
          icon={<UserCheck className="w-5 h-5 text-emerald-500" />}
          accent="emerald"
        />
        <MetricCard
          label="Pending Faculty Reviews"
          value={summary?.facultyReviewProjects ?? 0}
          icon={<FileCheck className="w-5 h-5 text-purple-500" />}
          accent="purple"
        />
        <MetricCard
          label="Total Faculty"
          value={facultyList.length}
          icon={<Users className="w-5 h-5 text-cyan-500" />}
          accent="cyan"
        />
        <MetricCard
          label="Available Faculty"
          value={facultyList.filter(faculty => faculty.role === 'faculty' && faculty.isActive !== false && (faculty.availability || faculty.facultyProfile?.availability || 'available') !== 'unavailable').length}
          icon={<Award className="w-5 h-5 text-indigo-500" />}
          accent="indigo"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Status Distribution Pie */}
        <div className="lg:col-span-5 glass-panel p-6 rounded-2xl space-y-4">
          <h3 className="text-base font-bold">Submission Pipeline Lifecycle</h3>
          <p className="text-xs text-[var(--text-secondary)]">Proposals, assignment readiness, review, evaluated, and closed projects.</p>
          <div className="h-64 flex items-center justify-center">
            {statusStats && statusStats.some(s => s.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusStats}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--text-primary)' }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-slate-500">No project activity recorded yet.</div>
            )}
          </div>
        </div>

        {/* Department Distribution Bar */}
        <div className="lg:col-span-7 glass-panel p-6 rounded-2xl space-y-4">
          <h3 className="text-base font-bold">Submissions by Department</h3>
          <p className="text-xs text-[var(--text-secondary)]">Department-wise capstone project counts.</p>
          <div className="h-64">
            {deptStats && deptStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="department" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="submissions" fill="var(--chart-teal)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-slate-500">
                No department submissions yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Submitted Projects & Reviewer Allocations Section */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold">Project Submissions & Reviewer Allocation</h3>
            <p className="text-xs text-[var(--text-secondary)]">Assign faculty reviewers and monitor plagiarism similarity scores.</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
            {projects.length} Total Projects
          </span>
        </div>

        {projects.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-900">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-900">
                <tr>
                  <th className="px-6 py-3.5">Project Title</th>
                  <th className="px-6 py-3.5">Leader / Team</th>
                  <th className="px-6 py-3.5">Cohort</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Formal Reviews / Marks</th>
                  <th className="px-6 py-3.5">Similarity</th>
                  <th className="px-6 py-3.5">Assigned Reviewer</th>
                  <th className="px-6 py-3.5 text-right">Assign Faculty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-900">
                {projects.map((proj) => {
                  const similarityDisplay = getSimilarityDisplayState(proj);
                  const stageSummaries = ['abstract', 'midterm', 'final'].map((phase, index) => {
                    const latest = (proj.stageSubmissions || [])
                      .filter((submission) => submission.phase === phase)
                      .sort((left, right) => Number(right.version) - Number(left.version))[0];
                    const evaluation = latest?.rubricEvaluation?.isPublished ? latest.rubricEvaluation : null;
                    const totalMarks = evaluation?.scores?.reduce((total, score) => total + Number(score.scoredMarks || 0), 0);
                    const maximumMarks = evaluation?.scores?.reduce((total, score) => total + Number(score.maxMarks || 0), 0);
                    return {
                      label: `R${index + 1}`,
                      status: latest?.status || 'not submitted',
                      marks: evaluation ? `${totalMarks} / ${maximumMarks}` : null,
                    };
                  });
                  return (
                    <tr key={proj._id} className="hover:bg-slate-500/5 transition-colors">
                      <td className="px-6 py-4 max-w-xs">
                        <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{proj.title || 'Title not available'}</p>
                        <p className="text-xs text-[var(--text-secondary)] truncate">{typeof proj.description === 'string' && proj.description.trim() ? proj.description : 'Description not available'}</p>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{getReferenceName(proj.leader, 'Leader not available')}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">{getProjectTeamSummary(proj)}</p>
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        <p>{getProjectDepartment(proj)}</p>
                        <p className="mt-1 text-[10px] font-normal text-[var(--text-secondary)]">
                          {getProjectCohort(proj)}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusBadgeStyle(proj.status)}`}
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {typeof proj.status === 'string' && proj.status
                            ? proj.status.replace(/_/g, ' ').toUpperCase()
                            : 'STATUS NOT AVAILABLE'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[10px]">
                        <div className="space-y-1">
                          {stageSummaries.map((stage) => (
                            <p key={stage.label} className="whitespace-nowrap">
                              <span className="font-bold text-[var(--text-primary)]">{stage.label}</span>
                              <span className="text-[var(--text-secondary)]"> · {stage.status.replace(/_/g, ' ')}</span>
                              {stage.marks && <span className="ml-1 font-semibold text-pink-500">{stage.marks}</span>}
                            </p>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        {proj.status === 'draft' ? (
                          <span className="italic text-[11px] text-[var(--text-secondary)]">Draft</span>
                        ) : (
                          <span
                            className={`font-bold px-2 py-0.5 rounded-md text-[11px] ${similarityDisplay.tone}`}
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {similarityDisplay.score === null ? similarityDisplay.label : `${similarityDisplay.score}% Similarity`}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs">
                      {proj.assignedFaculty ? (
                        <span className="font-semibold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                          <UserCheck className="w-3.5 h-3.5" />
                          {getReferenceName(proj.assignedFaculty, 'Reviewer details unavailable')}
                        </span>
                      ) : (
                        <span className="font-semibold italic text-[11px] text-[var(--text-secondary)]">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {ASSIGNMENT_READY_STATUSES.has(proj.status)
                        || (proj.assignedFaculty && ACTIVE_ASSIGNMENT_STATUSES.has(proj.status)) ? (
                          <div className="flex items-center justify-end gap-2">
                            <select
                              value={selectedFaculty[proj._id] || getReferenceId(proj.assignedFaculty)}
                              onChange={(e) => setSelectedFaculty(prev => ({ ...prev, [proj._id]: e.target.value }))}
                              className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
                              aria-label={`Assign faculty for ${proj.title || 'project'}`}
                            >
                              <option value="">Select Faculty</option>
                              {facultyList.map(f => (
                                <option key={f._id} value={f._id}>
                                  {f.name} ({f.department})
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleAssignReviewer(proj._id)}
                              disabled={assigningId === proj._id || !selectedFaculty[proj._id]}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {assigningId === proj._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Assign'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">Not assignment-ready</span>
                        )}
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-slate-400">No project submissions yet to allocate.</div>
        )}
      </div>

      {/* Complaints Management Section */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-amber-500" />
              Student Complaints & Appeals
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">Review student grievances, update resolution statuses, and respond formally.</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            {complaints.length} Total Complaints
          </span>
        </div>

        {complaintsError ? (
          <p role="alert" className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-200">{complaintsError}</p>
        ) : complaints.length > 0 ? (
          <div className="space-y-4 pt-2">
            {complaints.map(c => (
              <div key={c._id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/30 space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <h4 className="font-semibold text-sm text-white">{c.subject}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Submitted by: <strong className="text-slate-200">{c.user?.name}</strong> ({c.user?.email}) • Project: "{c.project?.title}"
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${
                    c.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                    c.status === 'in_review' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                    'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    {c.status?.replace('_', ' ')}
                  </span>
                </div>

                <p className="text-xs text-[var(--text-secondary)] bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
                  {c.description}
                </p>

                {c.adminResponse && (
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs">
                    <strong className="text-emerald-400 block mb-0.5">Admin Response:</strong>
                    <p className="text-slate-200">{c.adminResponse}</p>
                  </div>
                )}

                {/* Status action buttons */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Update Status:</span>
                    <button
                      onClick={() => handleUpdateComplaint(c._id, 'in_review')}
                      disabled={updatingComplaintId === c._id || c.status === 'in_review'}
                      className="px-2.5 py-1 text-xs rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20 transition-all cursor-pointer disabled:opacity-40"
                    >
                      In Review
                    </button>
                    <button
                      onClick={() => handleUpdateComplaint(c._id, 'resolved')}
                      disabled={updatingComplaintId === c._id || c.status === 'resolved'}
                      className="px-2.5 py-1 text-xs rounded-lg bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all cursor-pointer disabled:opacity-40"
                    >
                      Resolved
                    </button>
                    <button
                      onClick={() => setRespondingId(respondingId === c._id ? null : c._id)}
                      className="px-2.5 py-1 text-xs rounded-lg bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 border border-blue-500/20 transition-all cursor-pointer"
                    >
                      {respondingId === c._id ? 'Cancel' : 'Reply / Response'}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{formatDate(c.createdAt)}</span>
                </div>
                {complaintErrors[c._id] && <p role="alert" className="text-xs text-red-500">{complaintErrors[c._id]}</p>}

                {/* Inline response box */}
                {respondingId === c._id && (
                  <div className="pt-2 space-y-2">
                    <textarea
                      value={responseText[c._id] || ''}
                      onChange={(e) => setResponseText(prev => ({ ...prev, [c._id]: e.target.value }))}
                      placeholder="Enter official administrative resolution or feedback..."
                      rows={2}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleUpdateComplaint(c._id, 'resolved')}
                        disabled={updatingComplaintId === c._id || !responseText[c._id]?.trim()}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send Response & Resolve
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-slate-400">No student complaints filed.</div>
        )}
      </div>
    </div>
  );
}
