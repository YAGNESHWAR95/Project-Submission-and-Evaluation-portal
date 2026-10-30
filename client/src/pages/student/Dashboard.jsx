import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { getProjectById, getProjects, getStudentDeadlines } from '../../services/projectService';
import { getEvaluationsByProject } from '../../services/evaluationService';
import { getMyInvitations, getLeaderInvitations, acceptInvitation, rejectInvitation } from '../../services/invitationService';
import { getMyNotifications, markAsRead, markAllAsRead, clearMyNotifications } from '../../services/notificationService';
import { getMyComplaints, createComplaint } from '../../services/complaintService';
import { formatDate, getStatusBadgeStyle } from '../../utils/formatters';
import { getSimilarityDisplayState } from '../../utils/similarityDisplay';
import ProjectWorkspace from '../../components/ProjectWorkspace';
import { getRevisionPermissions, hasActiveRevisionAccess, hasRevisionPermissionItems } from '../../utils/revisionAccess';
import { PHASE_CRITERIA } from '../../utils/constants';
import { getInvitationDisplayStatus, groupInvitationHistory } from '../../utils/invitationDisplay';
import {
  FileText,
  Award,
  Layers,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Mail,
  Bell,
  MessageSquare,
  Check,
  X,
  Send,
  Loader2,
  ArrowRight,
} from 'lucide-react';

const getLatestStage = (project, phase) => (project?.stageSubmissions || [])
  .filter((submission) => submission.phase === phase)
  .sort((left, right) => Number(right.version) - Number(left.version))[0] || null;

const getBatchKey = (value) => {
  const normalized = String(value || '').trim().replace(/^batch\s*/i, '');
  const range = normalized.match(/^(20\d{2})\s*[-–]\s*(20\d{2})$/);
  return range ? range[2] : normalized.toLowerCase();
};

const phaseTitlePatterns = {
  abstract: /abstract|proposal|initial/i,
  midterm: /midterm|architecture|design/i,
  final: /final|demonstration|demo/i,
};

export default function StudentDashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab State: 'overview' | 'invitations' | 'notifications' | 'complaints'
  const [activeTab, setActiveTab] = useState(() => searchParams.get('section') || 'overview');

  const [project, setProject] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [deadline, setDeadline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Invitations
  const [invitations, setInvitations] = useState([]);
  const [leaderInvitations, setLeaderInvitations] = useState([]);
  const [processingInv, setProcessingInv] = useState(null);

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationActionMessage, setNotificationActionMessage] = useState(null);
  const [clearingNotifications, setClearingNotifications] = useState(false);

  // Complaints
  const [complaints, setComplaints] = useState([]);
  const [complaintSubject, setComplaintSubject] = useState('');
  const [complaintDesc, setComplaintDesc] = useState('');
  const [submittingComplaint, setSubmittingComplaint] = useState(false);
  const [openRevisionEditor, setOpenRevisionEditor] = useState(false);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // 1. Projects & Evaluations
      const projects = await getProjects();
      let currentProject = null;
      if (projects && projects.length > 0) {
        currentProject = projects[0];
        setProject(currentProject);

        if (!['draft', 'proposal_created'].includes(currentProject.status)) {
          const evals = await getEvaluationsByProject(currentProject._id);
          setEvaluations(evals || []);
        }
      }

      // 2. Show only this project's next eligible formal review deadline.
      const abstract = getLatestStage(currentProject, 'abstract');
      const midterm = getLatestStage(currentProject, 'midterm');
      const formalReviewStarted = currentProject?.stageWorkflowEnabled
        && !['draft', 'proposal_created', 'rejected', 'withdrawn'].includes(currentProject.status);
      const nextPhase = formalReviewStarted
        ? abstract?.status !== 'approved' ? 'abstract' : midterm?.status !== 'approved' ? 'midterm' : 'final'
        : null;
      if (currentProject?._id && nextPhase) {
        try {
          const deadlines = await getStudentDeadlines(currentProject._id);
          const projectBatchValues = [currentProject.batch, currentProject.deadline?.batch, currentProject.cohortId]
            .filter(Boolean)
            .map((value) => String(value).trim());
          const sameBatch = (item) => !projectBatchValues.length
            || projectBatchValues.some((value) => getBatchKey(item.batch) === getBatchKey(value));
          const projectBatch = projectBatchValues[0] || '';
          const exactPhase = deadlines.find((item) => (item.phase || 'final') === nextPhase && sameBatch(item));
          const titlePhaseMismatch = exactPhase ? null : deadlines.find((item) => (
            sameBatch(item)
            && (item.phase || 'final') !== nextPhase
            && phaseTitlePatterns[nextPhase].test(item.title || '')
          ));
          setDeadline(exactPhase || (titlePhaseMismatch ? { ...titlePhaseMismatch, phaseMismatchExpected: nextPhase } : null));
        } catch (deadlineError) {
          console.error('Failed to load project review deadline:', deadlineError);
          setDeadline(null);
        }
      } else {
        setDeadline(null);
      }

      // 3. Invitations
      const [invs, leaderInvs] = await Promise.all([
        getMyInvitations(),
        getLeaderInvitations().catch(() => []),
      ]);
      setInvitations(invs || []);
      setLeaderInvitations(leaderInvs || []);

      // 4. Notifications
      const notifData = await getMyNotifications();
      if (notifData) {
        setNotifications(notifData.notifications || []);
        setUnreadCount(notifData.unreadCount || 0);
      }

      // 5. Complaints
      const compList = await getMyComplaints();
      setComplaints(compList || []);
    } catch (err) {
      console.error('Failed to load student dashboard:', err);
      setError('Unable to load dashboard details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    if (!project?._id) return undefined;
    const refreshReviewData = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const [latestProject, latestEvaluations] = await Promise.all([
          getProjectById(project._id),
          getEvaluationsByProject(project._id),
        ]);
        setProject(latestProject);
        setEvaluations(latestEvaluations || []);
      } catch (refreshError) {
        console.warn('Unable to refresh review results.', refreshError);
      }
    };
    window.addEventListener('focus', refreshReviewData);
    const refreshTimer = window.setInterval(refreshReviewData, 30000);
    return () => {
      window.removeEventListener('focus', refreshReviewData);
      window.clearInterval(refreshTimer);
    };
  }, [project?._id]);

  useEffect(() => {
    const requestedSection = searchParams.get('section')
      || (searchParams.get('tab') === 'workspace' ? 'workspace' : null);
    if (!requestedSection) return;
    if (['overview', 'basicInfo', 'team', 'guide', 'projectDetails', 'reviews', 'workspace', 'invitations', 'notifications', 'complaints'].includes(requestedSection)) {
      setActiveTab(requestedSection);
    }
    if (requestedSection === 'workspace' && project) {
      setOpenRevisionEditor(searchParams.get('editRevision') === '1');
    } else {
      setOpenRevisionEditor(false);
    }
  }, [project, searchParams]);

  // Handle Accept Invitation
  const handleAcceptInvite = async (token) => {
    setProcessingInv(token);
    setError(null);
    try {
      const result = await acceptInvitation(token);
      setSuccessMessage(['failed', 'skipped'].includes(result.emailStatus)
        ? `Invitation accepted. The team leader email was ${result.emailStatus}.`
        : result.message || 'Invitation accepted! You are now a team member.');
      setTimeout(() => setSuccessMessage(null), 3500);
      await fetchDashboardData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to accept invitation');
    } finally {
      setProcessingInv(null);
    }
  };

  // Handle Reject Invitation
  const handleRejectInvite = async (token) => {
    setProcessingInv(token);
    setError(null);
    try {
      const result = await rejectInvitation(token);
      setSuccessMessage(['failed', 'skipped'].includes(result.emailStatus)
        ? `Invitation rejected. The team leader email was ${result.emailStatus}.`
        : result.message || 'Invitation rejected.');
      setTimeout(() => setSuccessMessage(null), 3500);
      await fetchDashboardData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject invitation');
    } finally {
      setProcessingInv(null);
    }
  };

  // Handle Mark Notification Read
  const handleMarkNotifRead = async (id) => {
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n._id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  // Handle Mark All Read
  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const handleClearAllNotifications = async () => {
    if (!notifications.length || !window.confirm('Clear all notifications for your account? This cannot be undone.')) return;
    setClearingNotifications(true);
    setNotificationActionMessage(null);
    try {
      await clearMyNotifications();
      setNotifications([]);
      setUnreadCount(0);
      setNotificationActionMessage({ type: 'success', text: 'All notifications were cleared.' });
    } catch {
      setNotificationActionMessage({ type: 'error', text: 'Unable to clear notifications. Please try again.' });
    } finally {
      setClearingNotifications(false);
    }
  };

  // Handle Create Complaint
  const handleCreateComplaint = async (e) => {
    e.preventDefault();
    if (!project || !complaintSubject.trim() || !complaintDesc.trim()) return;

    setSubmittingComplaint(true);
    setError(null);
    try {
      const newComp = await createComplaint({
        projectId: project._id,
        subject: complaintSubject.trim(),
        description: complaintDesc.trim(),
      });
      setComplaints(prev => [newComp, ...prev]);
      setComplaintSubject('');
      setComplaintDesc('');
      setSuccessMessage('Complaint submitted to administrative review.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit complaint');
    } finally {
      setSubmittingComplaint(false);
    }
  };

  // Countdown string
  const getCountdownString = () => {
    if (!deadline) return 'No active deadlines';
    if (deadline.phaseMismatchExpected) return 'Phase mapping needs correction';
    const startDiff = new Date(deadline.submissionStartDate) - new Date();
    if (startDiff > 0) {
      const days = Math.ceil(startDiff / (1000 * 60 * 60 * 24));
      return `Opens in ${days} day${days === 1 ? '' : 's'}`;
    }
    const diff = new Date(deadline.submissionEndDate) - new Date();
    if (diff < 0) return 'Deadline Closed';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days}d ${hours}h remaining`;
  };

  const isDeadlineClosed = () => {
    if (!deadline || deadline.phaseMismatchExpected) return false;
    return new Date(deadline.submissionEndDate) - new Date() < 0;
  };

  const isDeadlineNotOpen = () => Boolean(deadline
    && !deadline.phaseMismatchExpected
    && new Date(deadline.submissionStartDate) > new Date());

  const getPhaseEvaluation = (phase) => {
    const stageReview = (project?.stageSubmissions || [])
      .filter((submission) => submission.phase === phase && submission.rubricEvaluation?.isPublished)
      .sort((left, right) => Number(right.version) - Number(left.version))[0]?.rubricEvaluation;
    return stageReview || evaluations.find(e => e.phase === phase);
  };

  const getPhaseReviews = (phase) => {
    const records = (project?.stageSubmissions || [])
      .filter((submission) => submission.phase === phase && submission.status !== 'draft')
      .map((submission) => ({
        ...submission.rubricEvaluation,
        phase,
        version: submission.version,
        stageStatus: submission.status,
        reviewedAt: submission.reviewedAt || submission.rubricEvaluation?.evaluatedAt,
        stageFeedback: submission.feedback,
      }));
    evaluations.filter((evaluation) => evaluation.phase === phase).forEach((evaluation) => {
      const version = Number(evaluation.submissionVersion || 0);
      if (!records.some((record) => Number(record.version) === version)) {
        records.push({ ...evaluation, version, stageStatus: 'submitted' });
      }
    });
    if (!records.length) return [{ phase, version: null, stageStatus: 'not_submitted' }];
    return records.sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  };

  const getStepStatus = (phase) => {
    const phaseIndex = ['abstract', 'midterm', 'final'].indexOf(phase);
    const latest = getLatestStage(project, phase);
    if (latest?.status === 'approved') return 'completed';
    if (latest?.status === 'submitted' || latest?.status === 'resubmitted') return 'under_review';
    if (latest?.status === 'changes_requested') return 'revision_required';
    if (!project) return 'pending';
    if (project.status !== 'faculty_accepted') return phaseIndex === 0 ? 'proposal_pending' : 'locked';
    if (phaseIndex > 0 && getLatestStage(project, ['abstract', 'midterm', 'final'][phaseIndex - 1])?.status !== 'approved') return 'locked';
    return 'current';
  };

  const getStepStatusLabel = (phase) => {
    const status = getStepStatus(phase);
    if (status === 'completed') return 'Approved · signed off';
    if (status === 'under_review') return 'Submitted · awaiting faculty review';
    if (status === 'revision_required') return 'Revision requested';
    if (status === 'proposal_pending') return 'Locked · proposal awaiting faculty approval';
    if (status === 'locked') return `Locked · complete Review ${phase === 'final' ? 2 : 1} first`;
    if (status === 'current') return 'Available for submission';
    return 'Not available';
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 bg-slate-800/50 rounded-2xl"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-48 bg-slate-800/50 rounded-2xl md:col-span-2"></div>
          <div className="h-48 bg-slate-800/50 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  const receivedInvitationGroups = groupInvitationHistory(invitations);
  const leaderInvitationGroups = groupInvitationHistory(leaderInvitations, project?.teamMembers || []);
  const pendingInvs = receivedInvitationGroups.filter((group) => group.status === 'pending');
  const revisionPermissions = getRevisionPermissions(project?.revisionRequest);
  const hasRevisionItems = hasRevisionPermissionItems(project?.revisionRequest);

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-blue-600/10 to-indigo-600/10 border-blue-500/10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Student Portal</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            Welcome back, <strong className="text-white">{user?.name}</strong> • Department:{' '}
            <span className="text-blue-400 font-semibold">{user?.department}</span>
            {user?.rollNumber && ` • Roll: ${user.rollNumber}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/submit"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 cursor-pointer"
          >
            {project
              ? (['proposal_created', 'draft'].includes(project.status) ? 'View Proposal' : 'View Project')
              : 'Create Project Proposal'}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex gap-3 items-center">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex gap-3 items-center">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {hasActiveRevisionAccess(project?.revisionRequest) && (
        <section className="rounded-xl border border-emerald-500/35 bg-emerald-500/5 p-5" aria-labelledby="dashboard-revision-heading">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Revision Access Open</p>
              <h2 id="dashboard-revision-heading" className="mt-1 text-lg font-bold">Revision Required: {project.title}</h2>
              <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">{project.revisionRequest.reason || project.revisionRequest.feedback}</p>
              <p className="mt-3 text-xs text-[var(--text-secondary)]">
                Approved: {[...revisionPermissions.fields, ...revisionPermissions.fileTypes.map((type) => `${type} file`)].join(', ') || 'None'}
                {project.revisionRequest.dueDate && ` · Due ${new Date(project.revisionRequest.dueDate).toLocaleDateString()}`}
              </p>
              {!hasRevisionItems && <p role="alert" className="mt-3 text-sm font-semibold text-amber-300">Revision access is open, but no editable items are authorized. Contact your faculty guide.</p>}
            </div>
            <button
              type="button"
              onClick={() => { setActiveTab('workspace'); setOpenRevisionEditor(true); setSearchParams({ section: 'workspace', editRevision: '1' }, { replace: true }); }}
              disabled={!hasRevisionItems || String(project.leader?._id || project.leader) !== String(user?._id || user?.id)}
              className="shrink-0 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {hasRevisionItems ? 'Edit Revision' : 'Edit Revision unavailable'}
            </button>
          </div>
        </section>
      )}

      <div className="min-w-0 space-y-6">

      {activeTab === 'basicInfo' && project && (
        <section className="glass-panel space-y-5 rounded-xl p-6" aria-labelledby="student-basic-info-heading">
          <div>
            <h2 id="student-basic-info-heading" className="text-lg font-bold">Basic Info</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Project identity and proposal summary.</p>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Project title</dt><dd className="mt-1 font-semibold">{project.title || 'Title not provided'}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Project status</dt><dd className="mt-1 capitalize">{project.status?.replace(/_/g, ' ') || 'Not available'}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Project type</dt><dd className="mt-1">{project.projectType?.replace(/_/g, ' ') || 'Not specified'}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Department / cohort</dt><dd className="mt-1">{project.department || project.leader?.department || 'Department not listed'} · {project.batch || project.leader?.batch || 'Batch not listed'}</dd></div>
          </dl>
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Abstract</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{project.abstract || 'No abstract has been added.'}</p>
          </div>
        </section>
      )}

      {activeTab === 'team' && project && (
        <section className="glass-panel space-y-5 rounded-xl p-6" aria-labelledby="student-team-heading">
          <div>
            <h2 id="student-team-heading" className="text-lg font-bold">Team</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Accepted project members and invitation history.</p>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Team leader</h3>
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <p className="font-semibold">{project.leader?.name || user?.name || 'Leader details unavailable'}</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{project.leader?.rollNumber || user?.rollNumber || 'Roll number not listed'}</p>
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Accepted members</h3>
            {(project.teamMembers || []).filter((member) => String(member?._id || member) !== String(project.leader?._id || project.leader)).length > 0 ? (
              (project.teamMembers || [])
                .filter((member) => String(member?._id || member) !== String(project.leader?._id || project.leader))
                .map((member) => (
                  <div key={member?._id || member} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                    <p className="font-semibold">{member?.name || 'Team member details unavailable'}</p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">{member?.rollNumber || member?.email || 'Student identifier not listed'}</p>
                  </div>
                ))
            ) : <p className="text-sm text-[var(--text-secondary)]">No additional team members have accepted an invitation.</p>}
          </div>
          <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Invitation history</h3>
            {leaderInvitationGroups.length > 0 ? leaderInvitationGroups.map(({ key, student, status, invitation, attempts }) => (
              <div key={key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{student?.name || invitation.email || 'Student details unavailable'}</span>
                  <span className="text-xs capitalize text-[var(--text-secondary)]">{status}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {student?.rollNumber || 'Roll number not listed'}{student?.email || invitation.email ? ` · ${student?.email || invitation.email}` : ''}
                  {invitation.createdAt ? ` · Sent ${formatDate(invitation.createdAt)}` : ''}
                </p>
                {attempts.length > 0 && (
                  <details className="mt-2 text-xs text-[var(--text-secondary)]">
                    <summary className="cursor-pointer">Older attempts ({attempts.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {attempts.map((attempt) => (
                        <li key={attempt._id || attempt.token}>
                          {getInvitationDisplayStatus(attempt)} {attempt.createdAt ? `· ${formatDate(attempt.createdAt)}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )) : (
              <p className="text-sm text-[var(--text-secondary)]">No invitations have been sent by this account.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'guide' && project && (
        <section className="glass-panel space-y-4 rounded-xl p-6" aria-labelledby="student-guide-heading">
          <div>
            <h2 id="student-guide-heading" className="text-lg font-bold">Project Guide</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Current faculty assignment.</p>
          </div>
          {project.assignedFaculty ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs font-semibold uppercase text-slate-500">Faculty name</dt><dd className="mt-1 font-semibold">{project.assignedFaculty.name || 'Name not listed'}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-slate-500">Department</dt><dd className="mt-1">{project.assignedFaculty.department || 'Department not listed'}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-slate-500">Faculty ID</dt><dd className="mt-1">{project.assignedFaculty.facultyId || 'Not listed'}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-slate-500">Email</dt><dd className="mt-1">{project.assignedFaculty.email || 'Not listed'}</dd></div>
            </dl>
          ) : <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">A faculty guide has not been assigned yet.</p>}
        </section>
      )}

      {activeTab === 'projectDetails' && project && (
        <section className="glass-panel space-y-5 rounded-xl p-6" aria-labelledby="student-project-details-heading">
          <div>
            <h2 id="student-project-details-heading" className="text-lg font-bold">Project Details</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">The proposal information currently saved for this project.</p>
          </div>
          {[
            ['Problem statement', project.problemStatement || project.description],
            ['Objectives', project.objectives],
            ['Proposed solution', project.proposedSolution],
            ['Methodology', project.methodology],
            ['Expected outcome', project.expectedOutcome],
            ['Technologies', project.technologies],
            ['Domain', project.domain],
            ['Keywords', project.keywords],
          ].map(([label, value]) => (
            <div key={label} className="border-t border-slate-200 pt-3 first:border-0 first:pt-0 dark:border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{value || 'Not provided'}</p>
            </div>
          ))}
          {['draft', 'proposal_created'].includes(project.status) && (
            <Link to="/submit?mode=edit" className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Edit proposal</Link>
          )}
        </section>
      )}

      {['overview', 'reviews'].includes(activeTab) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main section */}
          <div className="lg:col-span-8 space-y-8">
            {project ? (
              <>
                {activeTab === 'overview' && <>
                {/* Project Card */}
                <div className="glass-panel p-6 rounded-2xl space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getStatusBadgeStyle(['proposal_created', 'draft'].includes(project.status) ? 'proposal_created' : project.status)}`}>
                        {['proposal_created', 'draft'].includes(project.status) ? 'PROJECT PROPOSAL' : project.status.toUpperCase().replace('_', ' ')}
                      </span>
                      <h2 className="text-xl font-bold mt-2">{project.title}</h2>
                      <p className="text-sm text-[var(--text-secondary)] mt-1">{project.description}</p>
                    </div>
                    {!['draft', 'proposal_created'].includes(project.status) && (() => {
                      const display = getSimilarityDisplayState(project);
                      return (
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-500">Similarity Score</span>
                          <p className={`text-lg font-bold ${display.score !== null && display.score > 15 ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {display.score === null ? display.label : `${display.score}%`}
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-900 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-blue-500" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Team Size</p>
                        <p className="text-xs font-semibold">{project.teamMembers?.length || 1} Members</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-indigo-500" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Project Stage</p>
                        <p className="text-xs font-semibold">
                          {({
                            proposal_created: 'Proposal Created',
                            draft: 'Proposal Draft',
                            uniqueness_checked: 'Proposal awaiting faculty approval',
                            faculty_review: 'Under Faculty Review',
                            faculty_accepted: 'Proposal Approved',
                            faculty_changes_requested: 'Changes Requested',
                            submitted: project.submittedAt ? formatDate(project.submittedAt) : 'Submitted',
                            under_review: 'Under Evaluation',
                            revision_required: 'Revision Required',
                            resubmitted: 'Resubmitted',
                            evaluated: 'Evaluation Complete',
                            approved: 'Approved',
                            rejected: 'Rejected',
                            withdrawn: 'Withdrawn',
                          })[project.status] || project.status.toUpperCase().replaceAll('_', ' ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Award className="w-5 h-5 text-purple-500" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">
                          {['proposal_created', 'draft'].includes(project.status) ? 'Project Guide' : 'Evaluator'}
                        </p>
                        <p className="text-xs font-semibold">
                          {project.assignedFaculty ? project.assignedFaculty.name : ['proposal_created', 'draft'].includes(project.status) ? 'Not Assigned' : 'Awaiting Reviewer'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {(['faculty_accepted', 'faculty_changes_requested', 'rejected'].includes(project.status) || project.facultyComment) && (
                    <div className="border-t border-slate-200 pt-3 text-sm dark:border-slate-900" role="status">
                      <p className="font-semibold">Proposal decision: {project.status === 'faculty_accepted' ? 'Approved' : project.status === 'rejected' ? 'Rejected' : 'Changes requested'}</p>
                      {project.facultyComment && <p className="mt-1 text-xs text-[var(--text-secondary)]">Faculty feedback: {project.facultyComment}</p>}
                      {project.status === 'faculty_accepted' && <p className="mt-1 text-xs text-emerald-300">Review 1 is the next formal submission; proposal approval is not a graded review.</p>}
                    </div>
                  )}

                  {['proposal_created', 'draft'].includes(project.status) && (
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <div className="text-xs text-(--text-secondary)">
                        <p>Project Guide: <strong className="text-(--text-primary)">{project.assignedFaculty?.name || 'Not Assigned'}</strong></p>
                        <p className="mt-1">Last Updated: {formatDate(project.updatedAt || project.createdAt)}</p>
                      </div>
                      <div className="flex gap-2">
                        <Link to="/submit?mode=view" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                          View Proposal
                        </Link>
                        {(project.leader?._id === user?._id || project.leader === user?._id) && (
                          <Link to="/submit?mode=edit" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                            Edit Proposal
                          </Link>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress Stepper Visualizer */}
                {!['draft', 'proposal_created'].includes(project.status) && (
                  <div className="glass-panel p-6 rounded-2xl">
                    <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-blue-500" />
                      Evaluation Milestone Tracker
                    </h3>

                    <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                      {/* Phase 1: Abstract */}
                      <div className="flex-1 flex gap-4 sm:flex-col sm:items-center text-left sm:text-center relative">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          getStepStatus('abstract') === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-500 border-2 border-emerald-500'
                            : getStepStatus('abstract') === 'current'
                            ? 'bg-blue-500/10 text-blue-500 border-2 border-blue-500 animate-pulse'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}>
                          {getStepStatus('abstract') === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : '1'}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Review 1 · Initial project</p>
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Proposal report and presentation</p>
                          <p className="mt-1 text-[10px] font-semibold text-[var(--text-secondary)]">{getStepStatusLabel('abstract')}</p>
                          {getPhaseEvaluation('abstract') && (
                            <p className="text-xs font-bold text-emerald-500 mt-1">
                              Marks: {getPhaseEvaluation('abstract').totalScore}/30
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Phase 2: Midterm */}
                      <div className="flex-1 flex gap-4 sm:flex-col sm:items-center text-left sm:text-center relative">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          getStepStatus('midterm') === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-500 border-2 border-emerald-500'
                            : getStepStatus('midterm') === 'current'
                            ? 'bg-blue-500/10 text-blue-500 border-2 border-blue-500 animate-pulse'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}>
                          {getStepStatus('midterm') === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : '2'}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Review 2 · Architecture and design</p>
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Updated report, UML, database design, and presentation</p>
                          <p className="mt-1 text-[10px] font-semibold text-[var(--text-secondary)]">{getStepStatusLabel('midterm')}</p>
                          {getPhaseEvaluation('midterm') && (
                            <p className="text-xs font-bold text-emerald-500 mt-1">
                              Marks: {getPhaseEvaluation('midterm').totalScore}/40
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Phase 3: Final */}
                      <div className="flex-1 flex gap-4 sm:flex-col sm:items-center text-left sm:text-center relative">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          getStepStatus('final') === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-500 border-2 border-emerald-500'
                            : getStepStatus('final') === 'current'
                            ? 'bg-blue-500/10 text-blue-500 border-2 border-blue-500 animate-pulse'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}>
                          {getStepStatus('final') === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : '3'}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Review 3 · Final demonstration</p>
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Final report, source, deployed execution, and presentation</p>
                          <p className="mt-1 text-[10px] font-semibold text-[var(--text-secondary)]">{getStepStatusLabel('final')}</p>
                          {getPhaseEvaluation('final') && (
                            <p className="text-xs font-bold text-emerald-500 mt-1">
                              Marks: {getPhaseEvaluation('final').totalScore}/60
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                </>}

                {activeTab === 'reviews' && <div className="space-y-5">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-500" />
                    Review Results
                  </h3>
                  {[
                    { phase: 'abstract', label: 'Review 1 · Proposal and initial project' },
                    { phase: 'midterm', label: 'Review 2 · Architecture and design' },
                    { phase: 'final', label: 'Review 3 · Final project demonstration' },
                  ].map(({ phase, label }) => (
                    <section key={phase} className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <h4 className="text-sm font-bold">{label}</h4>
                      {getPhaseReviews(phase).map((review, index) => {
                        const maximum = review.scores?.reduce((total, score) => total + Number(score.maxMarks || 0), 0)
                          || PHASE_CRITERIA[phase].reduce((total, criterion) => total + criterion.maxMarks, 0);
                        const evaluated = Boolean(review.isPublished && Number.isFinite(Number(review.totalScore)));
                        return (
                          <div key={`${phase}-${review.version ?? 'pending'}-${index}`} className="glass-panel p-4 rounded-lg border-l-4 border-l-blue-500">
                            <div className="flex flex-wrap justify-between gap-2 text-xs">
                              <span className="font-semibold">{review.version ? `Version ${review.version}` : 'No submission'} · {review.stageStatus.replace(/_/g, ' ')}</span>
                              <span className="font-bold text-blue-400">{evaluated ? `${review.totalScore} / ${maximum}` : 'Not evaluated'}</span>
                            </div>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]">
                              Faculty sign-off: {review.stageStatus === 'approved' || (review.stageStatus === 'submitted' && review.isPublished) ? 'Signed off' : 'Pending'}
                              {' · '}{review.reviewedAt || review.evaluatedAt ? `Review date: ${new Date(review.reviewedAt || review.evaluatedAt).toLocaleDateString()}` : 'Review date: pending'}
                            </p>
                            {review.scores?.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {review.scores.map((score, scoreIndex) => (
                                  <div key={`${score.criteriaName}-${scoreIndex}`} className="flex justify-between text-xs">
                                    <span>{score.criteriaName}</span>
                                    <span>{score.scoredMarks} / {score.maxMarks}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {review.feedback && <p className="mt-3 text-xs text-[var(--text-secondary)]">Evaluation feedback: {review.feedback}</p>}
                            {review.stageFeedback && <p className="mt-1 text-xs text-[var(--text-secondary)]">Faculty review: {review.stageFeedback}</p>}
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>}
              </>
            ) : (
              <div className="glass-panel p-12 rounded-2xl text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <FileText className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold">No Project Proposal Yet</h3>
                <p className="text-(--text-secondary) text-sm max-w-sm mx-auto">
                  Create a proposal for your project idea. You can save it even if Faculty/Admin has not configured a submission deadline.
                </p>
                <div className="pt-2">
                  <Link
                    to="/submit"
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
                  >
                    Create Project Proposal
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          {activeTab === 'overview' && <div className="lg:col-span-4 space-y-6">
            {/* Deadline Countdown widget */}
            <div className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950/40 border-indigo-500/10">
              <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400 mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Submission Deadline
              </h3>

              {deadline ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-bold text-white text-lg">{deadline.title}</h4>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {deadline.phaseMismatchExpected
                        ? `Review ${{ abstract: 1, midterm: 2, final: 3 }[deadline.phaseMismatchExpected]} · configured as ${deadline.phase || 'final'}; admin correction needed`
                        : `Review ${{ abstract: 1, midterm: 2, final: 3 }[deadline.phase || 'final']}`}
                      {' · Cohort: '}{deadline.batch}
                    </p>
                  </div>

                  <div className={`p-4 rounded-xl text-center border ${
                    deadline.phaseMismatchExpected
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                      : isDeadlineClosed()
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : isDeadlineNotOpen()
                          ? 'bg-pink-500/10 border-pink-500/20 text-pink-300'
                          : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300 animate-glow'
                  }`}>
                    <p className="text-xs uppercase font-bold tracking-wider opacity-70">Submission Time Window</p>
                    <p className="text-2xl font-black mt-1.5 tracking-tight font-mono">{getCountdownString()}</p>
                  </div>

                  <div className="text-xs text-slate-400 space-y-1 pt-2 border-t border-slate-800">
                    <div className="flex justify-between">
                      <span>Window Opens:</span>
                      <span className="font-semibold text-white">{new Date(deadline.submissionStartDate).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Submission Cutoff:</span>
                      <span className="font-semibold text-white">{new Date(deadline.submissionEndDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 text-sm py-4">No active timelines scheduled currently.</div>
              )}
            </div>

            {/* Submission Guidelines */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <h4 className="font-bold text-sm uppercase tracking-wider text-slate-400">
                {!project || ['proposal_created', 'draft'].includes(project.status) ? 'Proposal Checklist' : 'Submission Checklist'}
              </h4>
              {!project || ['proposal_created', 'draft'].includes(project.status) ? (
                <ul className="space-y-3 text-xs text-(--text-secondary)">
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /><span>Complete the required project proposal details.</span></li>
                  <li className="flex gap-2"><Clock className="w-4 h-4 text-blue-400 shrink-0" /><span>Faculty/Admin will assign a project guide and configure submission deadlines.</span></li>
                  <li className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /><span>Document uploads become available in a later project stage.</span></li>
                </ul>
              ) : (
                <ul className="space-y-3 text-xs text-[var(--text-secondary)]">
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /><span>Upload PDF document describing project Abstract/SRS scoping parameters.</span></li>
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /><span>Submit slide deck presentation file (.ppt / .pptx).</span></li>
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /><span>Bundle complete project source codes inside a compressed archive (.zip).</span></li>
                  <li className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /><span>System computes SHA-256 duplicate scans and copy checks instantly.</span></li>
                </ul>
              )}
            </div>
          </div>}
        </div>
      )}

      {activeTab === 'workspace' && project && (
        <ProjectWorkspace
          project={project}
          allowRevisionEditing
          autoEditRevision={openRevisionEditor}
          onChanged={(updated) => (updated ? setProject(updated) : fetchDashboardData())}
        />
      )}

      {/* Tab 2: Team Invitations */}
      {activeTab === 'invitations' && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-500" />
              Received Team Invitations
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              When a team leader invites you using your registered email address, it will appear here. Accepting will add you to their project team.
            </p>

            {receivedInvitationGroups.length > 0 ? (
              <div className="space-y-5 pt-2">
                {receivedInvitationGroups.map(({ key, student, status, invitation: inv, attempts }) => (
                      <div
                        key={key}
                        className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-900/40 p-4 dark:border-slate-800 sm:flex-row sm:items-center"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white">{inv.project?.title || 'Project Invitation'}</p>
                          <p className="mt-0.5 text-xs text-slate-300">
                            {student?.name || user?.name || 'Student name unavailable'}
                            {student?.rollNumber || user?.rollNumber ? ` · ${student?.rollNumber || user.rollNumber}` : ''}
                            {student?.email || user?.email ? ` · ${student?.email || user.email}` : ''}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                            Invited by: <strong className="text-slate-300">{inv.invitedBy?.name || 'Project leader'}</strong>
                            {inv.invitedBy?.email ? ` (${inv.invitedBy.email})` : ''}
                            {inv.invitedBy?.rollNumber ? ` · ${inv.invitedBy.rollNumber}` : ''}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-500">{inv.createdAt ? `Received ${formatDate(inv.createdAt)} · ` : ''}Expires: {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'Date unavailable'}</p>
                          {attempts.length > 0 && (
                            <details className="mt-2 text-xs text-[var(--text-secondary)]">
                              <summary className="cursor-pointer">Older attempts ({attempts.length})</summary>
                              <ul className="mt-1 space-y-1">
                                {attempts.map((attempt) => (
                                  <li key={attempt._id || attempt.token}>
                                    {getInvitationDisplayStatus(attempt)} {attempt.createdAt ? `· ${formatDate(attempt.createdAt)}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAcceptInvite(inv.token)}
                                disabled={processingInv === inv.token}
                                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {processingInv === inv.token ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRejectInvite(inv.token)}
                                disabled={processingInv === inv.token}
                                className="flex items-center gap-1.5 rounded-lg bg-red-600/80 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-700 disabled:opacity-50"
                              >
                                <X className="h-3.5 w-3.5" />
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${
                              status === 'accepted' ? 'bg-emerald-500/10 text-emerald-400'
                                : status === 'rejected' ? 'bg-red-500/10 text-red-400'
                                  : 'bg-slate-800 text-slate-400'
                            }`}>
                              {status}
                            </span>
                          )}
                        </div>
                      </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">
                No team invitations received.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Notifications */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Bell className="w-5 h-5 text-indigo-500" />
                  In-App Notifications
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">Stay updated on team invitations, grading milestones, and assignment status.</p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-all hover:bg-slate-800"
                  >
                    Mark All as Read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllNotifications}
                    disabled={clearingNotifications}
                    className="rounded-md border border-pink-500/30 px-3 py-1.5 text-xs font-semibold text-pink-300 transition-all hover:bg-pink-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {clearingNotifications ? 'Clearing…' : 'Clear all'}
                  </button>
                )}
              </div>
            </div>

            {notificationActionMessage && (
              <p role={notificationActionMessage.type === 'error' ? 'alert' : 'status'} className={`text-xs ${notificationActionMessage.type === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
                {notificationActionMessage.text}
              </p>
            )}

            {notifications.length > 0 ? (
              <div className="space-y-3 pt-2">
                {notifications.map(n => (
                  <div
                    key={n._id}
                    onClick={() => !n.isRead && handleMarkNotifRead(n._id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      n.isRead
                        ? 'border-slate-800/60 bg-slate-950/30 text-slate-400'
                        : 'border-blue-500/30 bg-blue-500/5 text-white shadow-sm'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-white">{n.title}</p>
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 mt-1">{n.message}</p>
                        <p className="text-[10px] text-slate-500 mt-1.5 font-mono">{formatDate(n.createdAt)}</p>
                        {['revision_requested', 'project_message', 'project_status'].includes(n.type) && n.relatedProject && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!n.isRead) handleMarkNotifRead(n._id);
                              setActiveTab('workspace');
                              setSearchParams({ section: 'workspace' }, { replace: true });
                              if (n.type === 'revision_requested') setOpenRevisionEditor(true);
                            }}
                            className="mt-3 rounded-md border border-blue-500/30 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/10"
                          >
                            {n.type === 'revision_requested' ? 'Open revision workspace' : 'Open project workspace'}
                          </button>
                        )}
                      </div>
                      {!n.isRead && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkNotifRead(n._id);
                          }}
                          className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold"
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">
                No notifications yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Complaints */}
      {activeTab === 'complaints' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Submit Complaint Form */}
          <div className="lg:col-span-5 space-y-6">
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <h3 className="font-bold text-base flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-500" />
                Submit a Project Complaint
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                File a formal complaint or appeal regarding your project submission, evaluation, or reviewer allocation.
              </p>

              {project ? (
                <form onSubmit={handleCreateComplaint} className="space-y-4 pt-2">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Project
                    </label>
                    <p className="text-sm font-semibold text-white px-3 py-2 bg-slate-900/60 rounded-xl border border-slate-800">
                      {project.title}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={complaintSubject}
                      onChange={(e) => setComplaintSubject(e.target.value)}
                      placeholder="e.g. Discrepancy in Midterm Rubric Marks"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Description & Details
                    </label>
                    <textarea
                      value={complaintDesc}
                      onChange={(e) => setComplaintDesc(e.target.value)}
                      rows={4}
                      placeholder="Describe the issue, specific criteria questioned, or explanation..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submittingComplaint}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submittingComplaint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Submit Complaint
                  </button>
                </form>
              ) : (
                <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-400 text-center">
                  You must have an active project before submitting a complaint.
                </div>
              )}
            </div>
          </div>

          {/* List of Complaints */}
          <div className="lg:col-span-7 space-y-6">
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <h3 className="font-bold text-base">My Submitted Complaints</h3>
              {complaints.length > 0 ? (
                <div className="space-y-4 pt-2">
                  {complaints.map(c => (
                    <div key={c._id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/30 space-y-2">
                      <div className="flex justify-between items-start">
                        <h4 className="font-semibold text-sm text-white">{c.subject}</h4>
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${
                          c.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          c.status === 'in_review' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          {c.status?.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)]">{c.description}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{formatDate(c.createdAt)}</p>

                      {c.adminResponse && (
                        <div className="mt-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs">
                          <strong className="text-emerald-400 block mb-1">Administrative Response:</strong>
                          <p className="text-slate-200">{c.adminResponse}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-500">
                  No complaints filed.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
