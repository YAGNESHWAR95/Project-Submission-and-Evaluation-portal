import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import useDebounce from '../../hooks/useDebounce';
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  uploadProjectFile,
  submitDraftProject,
  withdrawProject,
  getStudentDeadlines,
  runUniquenessCheck,
  submitProposalForReview,
} from '../../services/projectService';
import { sendInvitation, getLeaderInvitations, searchEligibleStudents } from '../../services/invitationService';
import { formatDate, getStatusBadgeStyle } from '../../utils/formatters';
import { hasActiveRevisionAccess } from '../../utils/revisionAccess';
import AuthenticatedFileDownload from '../../components/AuthenticatedFileDownload';
import ReportOriginalityPanel from '../../components/ReportOriginalityPanel';
import ProjectStageSubmissions from '../../components/ProjectStageSubmissions';
import { getSimilarityAlgorithmLabel, getSimilarityDisplayState, getSimilaritySemanticLabel, getSimilaritySectionScore } from '../../utils/similarityDisplay';
import { getInvitationDisplayStatus, groupInvitationHistory } from '../../utils/invitationDisplay';
import {
  Upload,
  FileText,
  AlertCircle,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Mail,
  Send,
  Clock,
  Download,
  AlertTriangle,
  UserCheck,
  ShieldAlert,
  CalendarDays,
  Pencil,
  Eye,
} from 'lucide-react';

const getBatchKey = (value) => {
  const normalized = String(value || '').trim().replace(/^batch\s*/i, '');
  const range = normalized.match(/^(20\d{2})\s*[-–]\s*(20\d{2})$/);
  return range ? range[2] : normalized.toLowerCase();
};

export default function SubmitProject() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const proposalMode = searchParams.get('mode') === 'edit' ? 'edit' : 'view';

  // Project state
  const [project, setProject] = useState(null);
  const [currentStep, setCurrentStep] = useState(() => Number(searchParams.get('step')) || 1);
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [proposalErrors, setProposalErrors] = useState({});
  const [showSubmitConfirmation, setShowSubmitConfirmation] = useState(false);
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [checkingUniqueness, setCheckingUniqueness] = useState(false);
  const [similaritySummary, setSimilaritySummary] = useState(null);

  // Create project form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadlineId, setDeadlineId] = useState('');
  const [projectDetails, setProjectDetails] = useState({
    projectType: 'major_project',
    academicYear: '',
    semester: '',
    section: '',
    abstract: '',
    objectives: '',
    proposedSolution: '',
    methodology: '',
    expectedOutcome: '',
    technologies: '',
    domain: '',
    keywords: '',
  });
  const [savingDraft, setSavingDraft] = useState(false);

  // Team invitation state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [invitationError, setInvitationError] = useState('');
  const [invitationSuccess, setInvitationSuccess] = useState('');
  const [leaderInvitations, setLeaderInvitations] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [ineligibleStudentMatches, setIneligibleStudentMatches] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [studentSearchError, setStudentSearchError] = useState('');
  const debouncedInviteSearch = useDebounce(inviteEmail, 350);

  // File upload states
  const [uploadingReport, setUploadingReport] = useState(false);
  const [uploadingPpt, setUploadingPpt] = useState(false);
  const [uploadingCode, setUploadingCode] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ report: 0, presentation: 0, source: 0 });

  const goToStep = (step) => {
    setCurrentStep(step);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('step', String(step));
    setSearchParams(nextParams, { replace: true });
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const projects = await getProjects();
      const existingProject = projects?.[0] || null;
      // Deadlines are informational for proposals and must not block loading them.
      let dList = [];
      try {
        dList = await getStudentDeadlines(existingProject?._id);
      } catch (deadlineError) {
        console.error('Failed to load student deadlines:', deadlineError);
      }
      const projectBatchValues = existingProject
        ? [existingProject.batch, existingProject.deadline?.batch, existingProject.cohortId]
        : [user?.batch, user?.cohortId];
      const normalizedProjectBatches = projectBatchValues.filter(Boolean).map((value) => getBatchKey(value));
      const applicableDeadlines = (dList || []).filter((deadline) => {
        if (!normalizedProjectBatches.length || user?.role === 'admin') return true;
        return !deadline.batch || normalizedProjectBatches.includes(getBatchKey(deadline.batch));
      });
      setDeadlines(applicableDeadlines);

      const finalDeadlines = applicableDeadlines.filter((deadline) => !deadline.phase || deadline.phase === 'final');
      const active = finalDeadlines.find((deadline) => deadline.isActive && new Date(deadline.submissionEndDate) >= new Date())
        || finalDeadlines.find((deadline) => deadline.isActive)
        || finalDeadlines[0];
      if (active) setDeadlineId(active._id);

      // Check existing projects for student
      if (projects && projects.length > 0) {
        setProject(existingProject);
        const maximumStep = existingProject.stageWorkflowEnabled ? 5 : 6;
        const requestedStep = Number(searchParams.get('step'));
        const selectedStep = Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= maximumStep
          ? requestedStep
          : 2;
        setCurrentStep(selectedStep);
        if (!searchParams.has('step')) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set('step', String(selectedStep));
          setSearchParams(nextParams, { replace: true });
        }
        setTitle(existingProject.title);
        setDescription(existingProject.description);
        setDeadlineId(existingProject.deadline?._id || existingProject.deadline || '');
        setProjectDetails((current) => ({
          ...current,
          projectType: existingProject.projectType || current.projectType,
          academicYear: existingProject.academicYear || '',
          semester: existingProject.semester || '',
          section: existingProject.section || '',
          abstract: existingProject.abstract || '',
          problemStatement: existingProject.problemStatement || existingProject.description || '',
          objectives: existingProject.objectives || '',
          proposedSolution: existingProject.proposedSolution || '',
          methodology: existingProject.methodology || '',
          expectedOutcome: existingProject.expectedOutcome || '',
          technologies: existingProject.technologies || '',
          domain: existingProject.domain || '',
          keywords: existingProject.keywords || '',
        }));

        // Load invitations if leader
        if (String(existingProject.leader?._id || existingProject.leader) === String(user?._id)) {
          const invList = await getLeaderInvitations();
          setLeaderInvitations(invList || []);
        }
      }
    } catch (err) {
      console.error('Failed to load project details:', err);
      setFormError('Failed to load submission requirements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  useEffect(() => {
    const requestedStep = Number(searchParams.get('step'));
    const maximumStep = project?.stageWorkflowEnabled ? 5 : 6;
    if (Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= maximumStep) {
      setCurrentStep(requestedStep);
    }
  }, [project?.stageWorkflowEnabled, searchParams]);

  useEffect(() => {
    if (project?.uniquenessCheck) {
      setSimilaritySummary(project.uniquenessCheck);
    }
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const query = debouncedInviteSearch.trim();
    if (!showInviteModal || !project?._id || query.length < 2) {
      setStudentSearchResults([]);
      setIneligibleStudentMatches([]);
      setStudentSearchError('');
      setSearchingStudents(false);
      return undefined;
    }

    setSearchingStudents(true);
    setStudentSearchError('');
    searchEligibleStudents(project._id, query)
      .then((result) => {
        if (!cancelled) {
          setStudentSearchResults(result.students || []);
          setIneligibleStudentMatches(result.ineligibleStudents || []);
        }
      })
      .catch((error) => {
        console.error('Eligible student search failed:', error.response?.data || error);
        if (!cancelled) setStudentSearchError(error.response?.data?.message || 'Unable to search students.');
      })
      .finally(() => {
        if (!cancelled) setSearchingStudents(false);
      });

    return () => { cancelled = true; };
  }, [debouncedInviteSearch, project?._id, showInviteModal]);

  const proposalValues = {
    title,
    domain: projectDetails.domain,
    abstract: projectDetails.abstract,
    problemStatement: projectDetails.problemStatement || description,
    objectives: projectDetails.objectives,
    methodology: projectDetails.methodology,
    technologies: projectDetails.technologies,
    expectedOutcome: projectDetails.expectedOutcome,
  };

  const proposalLimits = {
    title: 200,
    domain: 120,
    abstract: 3000,
    problemStatement: 5000,
    objectives: 5000,
    methodology: 5000,
    technologies: 1000,
    expectedOutcome: 5000,
  };

  const proposalLabels = {
    title: 'Project title',
    domain: 'Project domain',
    abstract: 'Project abstract',
    problemStatement: 'Problem statement',
    objectives: 'Project objectives',
    methodology: 'Proposed methodology',
    technologies: 'Technologies / tools',
    expectedOutcome: 'Expected outcome',
  };

  const handleRunUniquenessCheck = async () => {
    if (!project?._id) return;
    try {
      setCheckingUniqueness(true);
      const result = await runUniquenessCheck(project._id);
      setSimilaritySummary(result);
      setProject((current) => ({
        ...current,
        uniquenessCheck: result,
        status: 'uniqueness_checked',
      }));
      setSuccessMessage('Project uniqueness check completed.');
      setFormError(null);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Unable to complete the uniqueness check. Please try again.');
    } finally {
      setCheckingUniqueness(false);
    }
  };

  const handleSaveProposal = async (returnToDashboard = false) => {
    setFormError(null);
    setSuccessMessage(null);
    const errors = {};
    Object.entries(proposalValues).forEach(([field, value]) => {
      if (!value?.trim()) {
        errors[field] = `${proposalLabels[field]} is required.`;
      } else if (value.trim().length > proposalLimits[field]) {
        errors[field] = `Maximum ${proposalLimits[field]} characters.`;
      }
    });
    setProposalErrors(errors);
    if (Object.keys(errors).length > 0) {
      return null;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...proposalValues,
        ...Object.fromEntries(Object.entries(proposalValues).map(([field, value]) => [field, value.trim()])),
        description: proposalValues.problemStatement.trim(),
        deadline: deadlineId || undefined,
      };
      const saved = project
        ? await updateProject(project._id, payload)
        : await createProject(payload);
      setProject(saved);
      setProjectDetails((current) => ({
        ...current,
        ...payload,
        problemStatement: payload.problemStatement,
      }));
      setDescription(payload.problemStatement);
      setSuccessMessage('Project proposal saved successfully.');
      setSearchParams({ mode: 'view' });
      if (returnToDashboard) navigate('/');
      return saved;
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to save project proposal.');
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitProposalForReview = async () => {
    if (!project?._id || !isLeader || submittingProposal) return;
    setSubmittingProposal(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      const savedProposal = await handleSaveProposal();
      if (!savedProposal) return;

      const submission = await submitProposalForReview(savedProposal._id);
      const refreshedProject = await getProjectById(savedProposal._id);
      setProject(refreshedProject);
      setSimilaritySummary(submission.result);
      setSuccessMessage(submission.message || 'Proposal submitted for faculty review.');
    } catch (err) {
      setFormError(err.response?.data?.message || 'Unable to submit the proposal for faculty review.');
    } finally {
      setSubmittingProposal(false);
    }
  };

  const handleCreateProject = (event) => {
    event.preventDefault();
    handleSaveProposal();
  };

  const handleSaveDraft = async () => {
    if (!project || !isLeader || !isDraft) return;
    setSavingDraft(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      const updated = await updateProject(project._id, {
        title: title.trim(),
        description: description.trim() || projectDetails.abstract.trim(),
        ...projectDetails,
      });
      setProject(updated);
      setSuccessMessage('Draft saved successfully.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Unable to save project draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  // Handle Team Member Invitation by registered email
  const handleSendInvitation = async (e) => {
    e.preventDefault();
    if (!project || !inviteEmail.trim()) {
      console.warn('Invitation cancelled: missing project or email', { project: !!project, inviteEmail });
      return;
    }

    console.log('Attempting to send team invitation:', {
      projectId: project._id,
      inviteEmail: inviteEmail.trim(),
      leaderId: project.leader?._id || project.leader,
      userId: user?._id,
    });

    setInviting(true);
    setInvitationError('');
    setInvitationSuccess('');

    try {
      const result = await sendInvitation(project._id, inviteEmail.trim());
      console.log('Invitation created for:', inviteEmail.trim());
      setInvitationSuccess(result.emailStatus === 'accepted_by_resend'
        ? 'Invitation saved. Resend accepted the email request; check delivery in Resend.'
        : `Invitation saved. Email status: ${result.emailStatus || 'not available'}.`);
      setInviteEmail('');
      setShowInviteModal(false);
      setTimeout(() => setInvitationSuccess(''), 4000);

      // Refresh invitations list
      const invList = await getLeaderInvitations();
      setLeaderInvitations(invList || []);
    } catch (err) {
      console.error('Invitation submit failed:', {
        projectId: project?._id,
        inviteEmail: inviteEmail.trim(),
        errorResponse: err.response?.data,
        errorStatus: err.response?.status,
        errorMessage: err.message,
        stack: err.stack,
      });
      setInvitationError(err.response?.data?.message || 'Unable to send this invitation. Check the student details and try again.');
    } finally {
      setInviting(false);
    }
  };

  // Handle File Upload for a specific purpose
  const handleFileUpload = async (e, purpose) => {
    const file = e.target.files[0];
    if (!file || !project) return;

    setFormError(null);
    setSuccessMessage(null);

    // Validate client-side extension before uploading
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = {
      report: ['pdf'],
      presentation: ['ppt', 'pptx'],
      source: ['zip'],
    };

    if (!allowed[purpose].includes(ext)) {
      setFormError(`Invalid file format for ${purpose}. Allowed: .${allowed[purpose].join(', .')}`);
      return;
    }

    if (purpose === 'report') setUploadingReport(true);
    if (purpose === 'presentation') setUploadingPpt(true);
    if (purpose === 'source') setUploadingCode(true);

    try {
      const result = await uploadProjectFile(
        project._id,
        file,
        purpose,
        (percent) => {
          setUploadProgress(prev => ({ ...prev, [purpose]: percent }));
        }
      );

      // Update local project files state
      setProject(prev => {
        const updated = { ...prev };
        if (!updated.files) updated.files = {};
        if (purpose === 'report') {
          updated.files.reportUrl = result.url;
          updated.files.reportHash = result.hash;
          updated.files.reportName = result.originalName;
        } else if (purpose === 'presentation') {
          updated.files.pptUrl = result.url;
          updated.files.pptHash = result.hash;
          updated.files.pptName = result.originalName;
        } else if (purpose === 'source') {
          updated.files.codeZipUrl = result.url;
          updated.files.codeZipHash = result.hash;
          updated.files.codeZipName = result.originalName;
        }
        return updated;
      });

      setSuccessMessage(`${purpose.toUpperCase()} uploaded successfully! (SHA-256: ${result.hash?.substring(0, 16)}...)`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setFormError(err.response?.data?.message || `Failed to upload ${purpose}`);
    } finally {
      if (purpose === 'report') setUploadingReport(false);
      if (purpose === 'presentation') setUploadingPpt(false);
      if (purpose === 'source') setUploadingCode(false);
    }
  };

  // Handle Final Submission (changes status DRAFT -> SUBMITTED)
  const handleSubmitProject = async () => {
    if (!project) return;
    setFormError(null);
    setSuccessMessage(null);

    if (!isSubmissionWindowOpen) {
      return setFormError('The submission window for your cohort is not currently open. Check the deadline dates and try again during the open period.');
    }

    // Verify all 3 files exist
    if (!project.files?.reportUrl) {
      return setFormError('Project report (PDF) is required before final submission.');
    }
    if (!project.files?.pptUrl) {
      return setFormError('Presentation slide deck (PPT/PPTX) is required before final submission.');
    }
    if (!project.files?.codeZipUrl) {
      return setFormError('Source code bundle (ZIP) is required before final submission.');
    }

    setShowSubmitConfirmation(true);
  };

  const confirmSubmitProject = async () => {
    setSubmitting(true);
    try {
      const submitted = await submitDraftProject(project._id);
      setProject(submitted);
      setShowSubmitConfirmation(false);
      setSuccessMessage('Project successfully submitted! Plagiarism check has been initiated.');
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to submit project.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Project Withdrawal
  const handleWithdrawProject = async () => {
    if (!project) return;
    if (!window.confirm('Are you sure you want to withdraw this project submission? This cannot be undone.')) {
      return;
    }

    setSubmitting(true);
    try {
      await withdrawProject(project._id);
      setSuccessMessage('Project has been withdrawn.');
      setProject(prev => ({ ...prev, status: 'withdrawn' }));
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to withdraw project.');
    } finally {
      setSubmitting(false);
    }
  };

  const isLeader = project
    ? String(project.leader?._id || project.leader) === String(user?._id)
    : true;
  const isDraft = project?.status === 'draft';
  const canInviteTeamMembers = isLeader && ['proposal_created', 'draft'].includes(project?.status);
  const invitationAvailabilityMessage = project?.status === 'faculty_review' || project?.status === 'uniqueness_checked'
    ? 'Invitations are closed while the proposal is with faculty for review. They are available only while it is a draft or an unsubmitted proposal.'
    : 'Invitations are available only to the project leader while the project is a draft or an unsubmitted proposal.';
  const isSubmitted = project && project.status !== 'draft' && project.status !== 'withdrawn';
  const isWithdrawn = project?.status === 'withdrawn';
  const hasAllFiles = project?.files?.reportUrl && project.files?.pptUrl && project.files?.codeZipUrl;
  const projectDeadlineId = project?.deadline && typeof project.deadline === 'object'
    ? project.deadline._id
    : project?.deadline;
  const selectedDeadline = deadlines.find((item) => String(item._id) === String(projectDeadlineId))
    || (project?.deadline && typeof project.deadline === 'object' ? project.deadline : null);
  const isSubmissionWindowOpen = Boolean(
    selectedDeadline?.isActive
    && Date.now() >= new Date(selectedDeadline.submissionStartDate).getTime()
    && Date.now() <= new Date(selectedDeadline.submissionEndDate).getTime()
  );
  const abstractApproved = project?.stageSubmissions?.some((submission) => submission.phase === 'abstract' && submission.status === 'approved');
  const midtermApproved = project?.stageSubmissions?.some((submission) => submission.phase === 'midterm' && submission.status === 'approved');
  const finalPrerequisitesMet = !project?.stageWorkflowEnabled || (abstractApproved && midtermApproved);
  const canUploadSubmissionFiles = project?.status === 'faculty_accepted' && isSubmissionWindowOpen && finalPrerequisitesMet;
  const canSubmitProject = !project?.stageWorkflowEnabled && project?.status === 'faculty_accepted' && finalPrerequisitesMet;
  const submissionStepCount = project?.stageWorkflowEnabled ? 5 : 6;
  const acceptedTeamMembers = project?.teamMembers?.filter((member) => {
    const memberId = member?._id || member;
    return String(memberId) !== String(project?.leader?._id || project?.leader);
  }) || [];
  const invitationGroups = groupInvitationHistory(leaderInvitations, project?.teamMembers || []);
  const pendingInvitationCount = invitationGroups.filter((group) => group.status === 'pending').length;
  const renderInvitationHistory = () => (
    <div className="space-y-3">
      {invitationGroups.length > 0 ? invitationGroups.map(({ key, student, status, invitation, attempts }) => (
        <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-200">{student?.name || invitation.email || 'Student details unavailable'}</p>
              <p className="truncate text-[10px] text-slate-500">
                {student?.rollNumber || 'Roll number not listed'}{student?.email || invitation.email ? ` · ${student?.email || invitation.email}` : ''}
                {invitation.createdAt ? ` · Sent ${formatDate(invitation.createdAt)}` : ''}
              </p>
            </div>
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold capitalize ${
              status === 'accepted' ? 'bg-emerald-500/10 text-emerald-400'
                : status === 'rejected' ? 'bg-red-500/10 text-red-400'
                  : status === 'expired' ? 'bg-slate-800 text-slate-400'
                    : 'bg-amber-500/10 text-amber-400'
            }`}>
              {status}
            </span>
          </div>
          {attempts.length > 0 && (
            <details className="mt-2 border-t border-slate-800 pt-2 text-[10px] text-slate-400">
              <summary className="cursor-pointer">Older invitation attempts ({attempts.length})</summary>
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
      )) : <p className="text-xs text-slate-500">No invitation records.</p>}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    );
  }

  const isProposal = !project || ['proposal_created', 'draft'].includes(project.status);
  const hasGrantedRevisionAccess = hasActiveRevisionAccess(project?.revisionRequest);
  const hasPendingRevisionRequest = Boolean(project?.revisionRequest?.status === 'pending'
    && (project.revisionRequest.requestedAt || project.revisionRequest.requestedBy));
  const projectStatusLabel = (() => {
    if (hasGrantedRevisionAccess) return 'Revision Access Open — approved sections can be edited';
    const labels = {
      proposal_created: 'Proposal — awaiting faculty review',
      draft: 'Draft — editing available',
      uniqueness_checked: 'Similarity checked — awaiting faculty review',
      faculty_review: 'Under Review — awaiting faculty review',
      faculty_accepted: 'Proposal Approved — awaiting submission stage',
      faculty_changes_requested: hasPendingRevisionRequest
        ? 'Proposal revision required — awaiting faculty access'
        : 'Proposal — awaiting faculty review',
      submitted: 'Submitted — editing locked',
      under_review: 'Under Review — awaiting faculty review',
      revision_required: hasPendingRevisionRequest
        ? 'Proposal revision required — awaiting faculty access'
        : 'Proposal — awaiting faculty review',
      resubmitted: 'Resubmitted — awaiting faculty review',
      evaluated: 'Evaluated — review completed',
      approved: 'Approved — review completed',
      rejected: 'Rejected — review completed',
      withdrawn: 'Withdrawn',
    };
    return labels[project?.status] || 'Project status unavailable';
  })();
  if (isProposal) {
    const proposalDeadline = project
      ? selectedDeadline
      : deadlines.find((item) => String(item._id) === String(deadlineId));
    const deadlineStart = proposalDeadline?.submissionStartDate
      ? new Date(proposalDeadline.submissionStartDate)
      : null;
    const deadlineEnd = proposalDeadline?.submissionEndDate
      ? new Date(proposalDeadline.submissionEndDate)
      : null;
    const deadlineNotice = !proposalDeadline
      ? 'No deadline is assigned to this proposal.'
      : proposalDeadline.isActive === false
        ? 'This deadline is inactive. Contact Faculty/Admin for the current schedule.'
        : deadlineEnd && deadlineEnd < new Date()
          ? 'This submission deadline has expired.'
          : deadlineStart && deadlineStart > new Date()
            ? 'The submission window has not opened yet.'
            : 'The submission window is open.';
    const canEditProposal = !project || (
      ['proposal_created', 'draft'].includes(project.status)
      && String(project.leader?._id || project.leader) === String(user?._id)
    );
    const editing = !project || (proposalMode === 'edit' && canEditProposal);
    const fieldClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700';

    const renderField = (field, label, limit, multiline = false) => (
      <label key={field} className="block text-sm font-semibold text-(--text-primary)">
        {label} <span className="text-red-400">*</span>
        {multiline ? (
          <textarea
            value={proposalValues[field] || ''}
            onChange={(event) => {
              const value = event.target.value;
              if (field === 'title') setTitle(value);
              else if (field === 'problemStatement') {
                setDescription(value);
                setProjectDetails((current) => ({ ...current, problemStatement: value }));
              } else setProjectDetails((current) => ({ ...current, [field]: value }));
              setProposalErrors((current) => ({ ...current, [field]: '' }));
            }}
            rows={field === 'abstract' ? 4 : 3}
            maxLength={limit}
            disabled={!editing}
            className={fieldClass}
          />
        ) : (
          <input
            type="text"
            value={proposalValues[field] || ''}
            onChange={(event) => {
              const value = event.target.value;
              if (field === 'title') setTitle(value);
              else setProjectDetails((current) => ({ ...current, [field]: value }));
              setProposalErrors((current) => ({ ...current, [field]: '' }));
            }}
            maxLength={limit}
            disabled={!editing}
            className={fieldClass}
          />
        )}
        {editing && proposalErrors[field] && (
          <span className="mt-1 block text-xs font-medium text-red-400" role="alert">{proposalErrors[field]}</span>
        )}
        <span className="mt-1 block text-right text-xs font-normal text-slate-500">
          {(proposalValues[field] || '').length}/{limit}
        </span>
      </label>
    );

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
            className="rounded-lg border border-slate-300 p-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-400">Project Proposal</p>
            <h1 className="mt-1 text-2xl font-bold">{project ? project.title : 'Create Project Proposal'}</h1>
            <p className="mt-1 text-sm text-(--text-secondary)">
              {editing ? 'Describe the idea you are proposing for faculty review.' : 'Proposal details and current assignment information.'}
            </p>
          </div>
        </div>

        {formError && (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400" role="alert">
            <AlertCircle className="h-5 w-5 shrink-0" />{formError}
          </div>
        )}
        {successMessage && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400" role="status">
            <CheckCircle2 className="h-5 w-5 shrink-0" />{successMessage}
          </div>
        )}

        <form onSubmit={handleCreateProject} className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-5 xl:col-span-8">
            {project && (
              <section className="glass-panel rounded-xl p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold">TEAM MEMBERS</h2>
                  {canInviteTeamMembers && (
                    <button
                      type="button"
                      onClick={() => {
                        console.log('Invite Team Member button clicked', {
                          projectId: project?._id,
                          isLeader,
                          userId: user?._id,
                        });
                        setShowInviteModal(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/20"
                    >
                      <span className="text-base leading-none">+</span>
                      Invite Team Member
                    </button>
                  )}
                </div>
                {isLeader && invitationSuccess && <p role="status" className="mt-3 text-sm text-emerald-300">{invitationSuccess}</p>}
                {isLeader && !canInviteTeamMembers && <p className="mt-3 text-xs text-[var(--text-secondary)]">{invitationAvailabilityMessage}</p>}

                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Team Leader</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{project.leader?.name || user?.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{project.leader?.rollNumber || user?.rollNumber || 'Roll number not set'}</p>
                      </div>
                      <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-400">
                        Team Leader
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Team Members</p>
                    {acceptedTeamMembers.length > 0 ? (
                      <div className="space-y-2">
                        {acceptedTeamMembers.map((member) => (
                          <div key={member?._id || member} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/30">
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white">{member.name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{member.rollNumber || member.email || 'Roll number not set'}</p>
                            </div>
                            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                              Team Member
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No team members have joined yet.</p>
                    )}
                  </div>

                  {invitationGroups.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Invitation History</p>
                      {renderInvitationHistory()}
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="glass-panel space-y-5 rounded-xl p-5 sm:p-6">
              <div>
                <h2 className="text-base font-bold">Project Overview</h2>
                <p className="mt-1 text-xs text-(--text-secondary)">Core idea and intended area.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {renderField('title', 'Project Title', proposalLimits.title)}
                {renderField('domain', 'Project Domain', proposalLimits.domain)}
              </div>
              {renderField('abstract', 'Project Abstract', proposalLimits.abstract, true)}
            </section>

            <section className="glass-panel space-y-5 rounded-xl p-5 sm:p-6">
              <div>
                <h2 className="text-base font-bold">Problem and Objectives</h2>
                <p className="mt-1 text-xs text-(--text-secondary)">Explain the need and what the project intends to achieve.</p>
              </div>
              {renderField('problemStatement', 'Problem Statement', proposalLimits.problemStatement, true)}
              {renderField('objectives', 'Project Objectives', proposalLimits.objectives, true)}
            </section>

            <section className="glass-panel space-y-5 rounded-xl p-5 sm:p-6">
              <div>
                <h2 className="text-base font-bold">Approach and Outcome</h2>
                <p className="mt-1 text-xs text-(--text-secondary)">Describe how you plan to build it and what you expect to produce.</p>
              </div>
              {renderField('methodology', 'Proposed Methodology', proposalLimits.methodology, true)}
              <div className="grid gap-5 sm:grid-cols-2">
                {renderField('technologies', 'Technologies / Tools', proposalLimits.technologies)}
                {renderField('expectedOutcome', 'Expected Outcome', proposalLimits.expectedOutcome, true)}
              </div>
            </section>

            <div className="flex flex-wrap justify-end gap-3">
              {project && canEditProposal && !editing && (
                <button
                  type="button"
                  onClick={() => setSearchParams({ mode: 'edit' })}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-700"
                >
                  <Pencil className="h-4 w-4" />Edit Proposal
                </button>
              )}
              {editing && (
                <>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"
                  >
                    {submitting ? 'Saving...' : 'Save Proposal Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveProposal(true)}
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save and Return to Dashboard
                  </button>
                </>
              )}
              {project?.status === 'proposal_created' && isLeader && (
                <button
                  type="button"
                  onClick={handleSubmitProposalForReview}
                  disabled={submitting || submittingProposal}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submittingProposal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submittingProposal ? 'Submitting Proposal...' : 'Submit Proposal for Faculty Review'}
                </button>
              )}
              {project && (
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  Back to Dashboard
                </button>
              )}
            </div>
          </div>

          <aside className="space-y-5 xl:col-span-4">
            <section className="glass-panel rounded-xl p-5">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-blue-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider">Submission Deadline</h2>
              </div>
              {proposalDeadline ? (
                <>
                  <p className="mt-4 text-sm font-semibold">{proposalDeadline.title || 'Assigned cohort deadline'}</p>
                  {deadlineStart && <p className="mt-2 text-sm text-(--text-secondary)">Opens: {deadlineStart.toLocaleString()}</p>}
                  {deadlineEnd && <p className="mt-1 text-sm text-(--text-secondary)">Closes: {deadlineEnd.toLocaleString()}</p>}
                  <p className="mt-3 text-xs text-(--text-secondary)" role="status">Proposal saving and faculty review do not require formal documents or a review deadline. Each formal stage checks its own configured window. {deadlineNotice}</p>
                </>
              ) : (
                <p className="mt-4 text-sm text-(--text-secondary)" role="status">Proposal saving and faculty review do not require formal documents or a review deadline. Each formal stage checks its own configured window. {deadlineNotice}</p>
              )}
              <p className="mt-2 text-xs text-(--text-secondary)">Configured by Faculty/Admin. Students cannot modify this deadline.</p>
            </section>

            <section className="glass-panel rounded-xl p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider">Project Guide</h2>
              {project?.assignedFaculty ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <div><dt className="text-xs text-(--text-secondary)">Faculty Name</dt><dd className="mt-0.5 font-semibold">{project.assignedFaculty.name}</dd></div>
                  <div><dt className="text-xs text-(--text-secondary)">Department</dt><dd className="mt-0.5">{project.assignedFaculty.department || 'Not listed'}</dd></div>
                  <div><dt className="text-xs text-(--text-secondary)">Designation</dt><dd className="mt-0.5">Not listed</dd></div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-(--text-secondary)">Project guide will be assigned by Faculty/Admin.</p>
              )}
            </section>

            {project && (
              <section className="glass-panel rounded-xl p-5">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-400" />
                  <h2 className="text-sm font-bold uppercase tracking-wider">Proposal Status</h2>
                </div>
                <p className="mt-3 font-semibold">{project.status === 'draft' ? 'Proposal Draft' : 'Proposal Created'}</p>
                <p className="mt-1 text-xs text-(--text-secondary)">Last updated {formatDate(project.updatedAt || project.createdAt)}</p>
              </section>
            )}
          </aside>
        </form>
        {showInviteModal && project && isLeader && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="presentation">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-team-member-title"
              className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="invite-team-member-title" className="text-xl font-bold">Invite Team Member</h2>
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-lg border border-slate-700 px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSendInvitation} className="mt-4 space-y-4">
                <label className="block text-sm font-semibold text-slate-200">
                  College Email / Roll Number
                  <input
                    type="text"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Search by college email or roll number"
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    autoFocus
                  />
                </label>

                <div className="space-y-1" aria-live="polite">
                  {searchingStudents && <p className="text-xs text-slate-400">Searching eligible students...</p>}
                  {studentSearchError && <p className="text-xs text-red-400">{studentSearchError}</p>}
                  {!searchingStudents && !studentSearchError && debouncedInviteSearch.trim().length >= 2 && studentSearchResults.length === 0 && (
                    ineligibleStudentMatches.length > 0 ? (
                      <div className="space-y-2">
                        {ineligibleStudentMatches.map((student) => (
                          <div key={student._id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                            <p className="font-semibold text-white">{student.name}</p>
                            <p className="mt-1">{student.rollNumber || student.email}</p>
                            <p className="mt-1">{student.reason || `Student belongs to ${student.cohortId || 'a different cohort'}. Team members must belong to the same cohort as your project.`}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No eligible students found in your cohort.</p>
                    )
                  )}
                  {studentSearchResults.map((student) => (
                    <button
                      key={student._id}
                      type="button"
                      onClick={() => setInviteEmail(student.email)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left hover:border-blue-500/50"
                    >
                      <span>
                        <span className="block text-sm font-semibold text-white">{student.name}</span>
                        <span className="block text-xs text-slate-400">{student.rollNumber} · {student.department} · {student.section}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-blue-300">Select</span>
                    </button>
                  ))}
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inviting ? 'Sending...' : 'Send Invitation'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-900 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Project Submission Portal</h1>
          <p className="text-[var(--text-secondary)] text-sm">
            {project
              ? `Manage deliverables and team for: "${project.title}"`
              : 'Create a new capstone project draft and configure submission details.'}
          </p>
        </div>
      </div>

      {formError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex gap-3 items-center">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex gap-3 items-center">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Case 1: No project yet -> Create Project Form (Step 1) */}
      {!project && (
        <form onSubmit={handleCreateProject} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className={currentStep === 2 ? 'lg:col-span-8 space-y-6' : 'lg:col-span-12 space-y-6'}>
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-base">Step 1: Create Project Draft</h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-semibold border border-blue-500/20">
                  DRAFT Initializer
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Capstone Project Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="e.g. Deep Learning for Medical Imaging Classification"
                  maxLength={200}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Project Type <span className="text-red-400">*</span>
                  <select
                    value={projectDetails.projectType}
                    onChange={(e) => setProjectDetails((current) => ({ ...current, projectType: e.target.value }))}
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100 text-sm normal-case"
                    required
                  >
                    <option value="mini_project">Mini Project</option>
                    <option value="major_project">Major Project / Capstone</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Academic Year
                    <input
                      value={projectDetails.academicYear}
                      onChange={(e) => setProjectDetails((current) => ({ ...current, academicYear: e.target.value }))}
                      maxLength={20}
                      placeholder="2026-27"
                      className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm normal-case"
                    />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Semester
                    <input
                      value={projectDetails.semester}
                      onChange={(e) => setProjectDetails((current) => ({ ...current, semester: e.target.value }))}
                      maxLength={40}
                      placeholder="Semester 7"
                      className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm normal-case"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2.5">
                  <p className="font-bold uppercase tracking-wider text-slate-400">Department</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{user?.department || 'Not set in profile'}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2.5">
                  <p className="font-bold uppercase tracking-wider text-slate-400">Student</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{user?.name || 'Current student'}</p>
                  <p className="text-[var(--text-secondary)]">{user?.rollNumber || 'Roll number not set'}</p>
                </div>
                <label className="block font-bold uppercase tracking-wider text-slate-400">
                  Section
                  <input
                    value={projectDetails.section}
                    onChange={(e) => setProjectDetails((current) => ({ ...current, section: e.target.value }))}
                    maxLength={40}
                    placeholder="Section"
                    className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Project Abstract <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={projectDetails.abstract}
                  onChange={(e) => setProjectDetails((current) => ({ ...current, abstract: e.target.value }))}
                  rows={4}
                  maxLength={3000}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="Summarize the project problem, approach, and expected contribution."
                  required
                />
                <p className="mt-1 text-right text-[10px] text-slate-500">{projectDetails.abstract.length}/3000</p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Problem Statement
                </label>
                <textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setProjectDetails((current) => ({ ...current, problemStatement: e.target.value }));
                  }}
                  rows={4}
                  maxLength={5000}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="Describe the problem this project addresses."
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Optional Cohort Deadline Association
                </label>
                <select
                  value={deadlineId}
                  onChange={(e) => setDeadlineId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/60 text-sm text-slate-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={deadlines.length === 0}
                >
                  <option value="">
                    {deadlines.some((deadline) => !deadline.phase || deadline.phase === 'final') ? 'No deadline association' : 'No active final deadline available'}
                  </option>
                  {deadlines.filter((deadline) => !deadline.phase || deadline.phase === 'final').map((d) => (
                    <option key={d._id} value={d._id}>
                      {d.title} ({d.batch}) — Ends: {new Date(d.submissionEndDate).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {!deadlines.some((deadline) => !deadline.phase || deadline.phase === 'final') && (
                  <p className="mt-2 text-xs text-amber-500" role="status">
                    Proposal creation does not require a deadline. An administrator must configure a phase deadline before formal review uploads can be submitted.
                  </p>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Proposal Draft
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <h4 className="font-bold text-sm uppercase tracking-wider text-slate-400">Submission Flow</h4>
              <ul className="space-y-3 text-xs text-[var(--text-secondary)]">
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-[10px] shrink-0">1</span>
                  <span>Create draft project. You automatically become the Project Leader.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-[10px] shrink-0">2</span>
                  <span>Invite team members by registered email address.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-[10px] shrink-0">3</span>
                  <span>Upload PDF Report, PPT Slides, and Source ZIP.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-[10px] shrink-0">4</span>
                  <span>Run plagiarism verification and submit before deadline cutoff.</span>
                </li>
              </ul>
            </div>
          </div>
        </form>
      )}

      {/* Case 2: Project exists -> Manage deliverables, team invitations, and submit */}
      {project && (
        <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <p className="text-sm font-bold">Step {currentStep} of {submissionStepCount}</p>
          <span className="text-xs font-medium text-[var(--text-secondary)]">{projectStatusLabel}</span>
        </div>
          {hasGrantedRevisionAccess && (
            <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="font-semibold text-emerald-300">Revision Access Open</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{project.revisionRequest.reason || project.revisionRequest.feedback}</p>
              <button type="button" onClick={() => navigate('/?section=workspace&editRevision=1')} className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">
                Edit Revision in Project Workspace
              </button>
            </div>
          )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main Column */}
          <div className="lg:col-span-8 space-y-6">
            {/* Status and Overview Card */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getStatusBadgeStyle(project.status)}`}>
                    {project.status.toUpperCase().replace('_', ' ')}
                  </span>
                  <h2 className="text-xl font-bold mt-2">{project.title}</h2>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">{project.description}</p>
                </div>
                {isDraft && isLeader && (
                  <button
                    onClick={handleWithdrawProject}
                    disabled={submitting}
                    className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-xl border border-red-500/20 hover:bg-red-500/10 transition-all cursor-pointer"
                  >
                    Withdraw Project
                  </button>
                )}
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="font-bold text-slate-400 uppercase text-[10px]">Project Leader</p>
                  <p className="font-semibold text-white mt-0.5">{project.leader?.name || user?.name} (You)</p>
                </div>
                <div>
                  <p className="font-bold text-slate-400 uppercase text-[10px]">Cohort</p>
                  <p className="font-semibold text-white mt-0.5">{project.cohort || project.cohortId || project.batch || project.deadline?.batch || project.leader?.batch || 'N/A'}</p>
                </div>
                <div>
                  <p className="font-bold text-slate-400 uppercase text-[10px]">Plagiarism Status</p>
                  <p className="font-semibold text-white mt-0.5">
                    {project.status === 'draft'
                      ? 'Pending Final Submission'
                      : (() => {
                          const state = project?.uniquenessCheck ? project.uniquenessCheck : { status: 'not_checked', overallScore: 0 };
                          return state.status === 'failed' || state.status === 'insufficient_text' || state.status === 'not_checked'
                            ? 'Similarity not available'
                            : `${state.overallScore ?? 0}% Similarity`;
                        })()}
                  </p>
                </div>
              </div>
            </div>

            {['uniqueness_checked', 'faculty_review', 'faculty_changes_requested', 'faculty_accepted', 'rejected'].includes(project.status) && (
              <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800" role="status">
                <p className="font-semibold">Proposal status: {project.status === 'faculty_accepted' ? 'Approved' : project.status === 'faculty_changes_requested' ? 'Changes requested' : project.status === 'rejected' ? 'Rejected' : 'Awaiting faculty approval'}</p>
                {project.facultyComment && <p className="mt-1 text-[var(--text-secondary)]">Faculty feedback: {project.facultyComment}</p>}
                {project.status === 'faculty_accepted' && <p className="mt-1 text-xs text-emerald-300">Review 1 is the next formal document submission. Proposal approval is not a graded review.</p>}
              </div>
            )}

            {currentStep === 1 && (
              <fieldset disabled={!isDraft || !isLeader} className="contents">
              <div className="glass-panel p-6 rounded-2xl space-y-4">
                <h3 className="text-base font-bold">Basic Project Information</h3>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Project Title *
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Project Type *
                    <select
                      value={projectDetails.projectType}
                      onChange={(e) => setProjectDetails((current) => ({ ...current, projectType: e.target.value }))}
                      className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100 text-sm normal-case"
                    >
                      <option value="mini_project">Mini Project</option>
                      <option value="major_project">Major Project / Capstone</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2.5 text-xs">
                    <p className="font-bold uppercase tracking-wider text-slate-400">Department / Cohort</p>
                    <p className="mt-1 text-sm">{user?.department || project.department || 'Not set'} · {project.cohort || project.cohortId || project.batch || project.deadline?.batch || 'Not set'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    ['academicYear', 'Academic Year', 20],
                    ['semester', 'Semester', 40],
                    ['section', 'Section', 40],
                  ].map(([field, label, maxLength]) => (
                    <label key={field} className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                      {label}
                      <input
                        value={projectDetails[field]}
                        onChange={(e) => setProjectDetails((current) => ({ ...current, [field]: e.target.value }))}
                        maxLength={maxLength}
                        className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                      />
                    </label>
                  ))}
                </div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Project Abstract *
                  <textarea
                    value={projectDetails.abstract}
                    onChange={(e) => setProjectDetails((current) => ({ ...current, abstract: e.target.value }))}
                    maxLength={3000}
                    rows={4}
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Problem Statement
                  <textarea
                    value={projectDetails.problemStatement || description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setProjectDetails((current) => ({ ...current, problemStatement: e.target.value }));
                    }}
                    maxLength={5000}
                    rows={3}
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                  />
                </label>
                {isDraft && isLeader && (
                  <div className="flex justify-end">
                    <button type="button" onClick={handleSaveDraft} disabled={savingDraft || !title.trim() || !projectDetails.abstract.trim()} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold disabled:opacity-50">
                      {savingDraft ? 'Saving...' : 'Save Draft'}
                    </button>
                  </div>
                )}
              </div>
              </fieldset>
            )}

            {currentStep === 1 && (
              <div className="glass-panel p-6 rounded-2xl space-y-5">
                <h3 className="text-base font-bold">Project Uniqueness Check</h3>
                <p className="text-sm text-[var(--text-secondary)]">The similarity check compares your proposal against existing project proposals in this portal and flags possible overlaps without auto-rejecting your work. It is not a definitive plagiarism verdict and does not evaluate internet sources or external submissions.</p>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleRunUniquenessCheck}
                    disabled={checkingUniqueness || !project?._id || !isLeader}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkingUniqueness ? 'Analyzing project similarity...' : 'Run Uniqueness Check'}
                  </button>
                </div>

                {similaritySummary ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Similarity Score</p>
                        <p className="mt-1 font-semibold">{getSimilarityDisplayState({ uniquenessCheck: similaritySummary }).score === null
                          ? getSimilarityDisplayState({ uniquenessCheck: similaritySummary }).label
                          : `${getSimilarityDisplayState({ uniquenessCheck: similaritySummary }).score}%`}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Result</p>
                        <p className="mt-1 font-semibold capitalize">{(similaritySummary.status === 'completed'
                          ? similaritySummary.result || similaritySummary.status
                          : similaritySummary.status || 'Not available').replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">Similarity measures overlap in these project records. It is not a probability of plagiarism or a plagiarism finding.</p>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">Algorithm</p>
                      <p className="mt-1 font-semibold">{getSimilarityAlgorithmLabel(similaritySummary)}</p>
                    </div>
                    {similaritySummary.scoreMethod && <p className="text-xs text-slate-400">{similaritySummary.scoreMethod}</p>}
                    {similaritySummary.matches?.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Potentially Similar Projects</p>
                        <ul className="mt-2 space-y-2 text-sm">
                          {similaritySummary.matches.map((match, index) => (
                            <li key={match.projectId || index} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                              <div className="flex justify-between gap-3">
                                <p className="font-semibold">{match.title || 'Historical project'}</p>
                                <p className="text-xs text-slate-300">{match.similarityScore ?? 'N/A'}% overall</p>
                              </div>
                              <p className="mt-1 text-xs text-slate-400">
                                Text {match.scoreBreakdown?.textSimilarity ?? match.textSimilarity ?? 'N/A'}% × {match.scoreBreakdown?.textWeight ?? 'N/A'}%; {getSimilaritySemanticLabel(match)}; combined {match.scoreBreakdown?.combinedSimilarity ?? match.similarityScore ?? 'N/A'}%.
                              </p>
                              <p className="mt-1 text-xs text-slate-400">{match.explanation || match.evidence || 'No comparison explanation was recorded.'}</p>
                              {Array.isArray(match.sectionComparisons) && match.sectionComparisons.length > 0 ? (
                                <div className="mt-2 space-y-2 border-t border-slate-800 pt-2 text-xs">
                                  {match.sectionComparisons.map((section) => (
                                    <div key={section.field} className="grid grid-cols-[minmax(7rem,0.7fr)_auto_1.5fr] gap-2 items-start">
                                      <span className="font-medium">{section.label || section.field}</span>
                                      <span>{getSimilaritySectionScore(section)}</span>
                                      <span className="text-slate-400">{section.matchingTerms?.length ? `Shared terms: ${section.matchingTerms.join(', ')}. ` : ''}{section.explanation || 'No section evidence recorded.'}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400">Section evidence was not recorded for this legacy result.</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">Status: Not checked yet</p>
                )}
                <ReportOriginalityPanel analysis={project?.reportOriginality} />
              </div>
            )}

            {currentStep === 2 && (
              <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div>
                  <h3 className="text-base font-bold">Team and Invitations</h3>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">Review the leader, accepted members, and invitation statuses. Invitations are restricted to students in this project cohort.</p>
                </div>
                {isLeader && (
                  <button type="button" onClick={() => setShowInviteModal(true)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Invite a team member
                  </button>
                )}
                <p className="text-xs text-[var(--text-secondary)]">
                  {acceptedTeamMembers.length + 1} accepted team member{acceptedTeamMembers.length === 0 ? '' : 's'} · {pendingInvitationCount} pending invitation{pendingInvitationCount === 1 ? '' : 's'}
                </p>
              </div>
            )}

            {currentStep === 3 && (
              <div className="glass-panel p-6 rounded-2xl">
                <h3 className="text-base font-bold">Project Guide</h3>
                {project.assignedFaculty ? (
                  <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
                    <p className="font-semibold">{project.assignedFaculty.name}</p>
                    <p className="text-sm text-[var(--text-secondary)]">{project.assignedFaculty.department || 'Department not listed'}</p>
                    <p className="text-xs text-slate-500">{project.assignedFaculty.facultyId || 'Faculty guide'}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">A faculty guide has not been assigned. Guide assignment is managed by the administrator.</p>
                )}
              </div>
            )}

            {currentStep === 6 && !project.stageWorkflowEnabled && (
              <div className="glass-panel p-6 rounded-2xl space-y-4">
                <h3 className="text-base font-bold">Review & Submit</h3>
                <p className="text-sm text-[var(--text-secondary)]">Check the submission requirements before confirming. The server revalidates proposal approval, project ownership, required files, team membership, and deadline.</p>
                <ul className="space-y-2 text-sm">
                  {[
                    ['Proposal approved by faculty', project.status === 'faculty_accepted'],
                    ['Project title and abstract', Boolean(project.title?.trim() && project.abstract?.trim())],
                    ['Team leader and accepted members', Boolean(project.teamMembers?.length)],
                    ['Project guide assigned', Boolean(project.assignedFaculty)],
                    ['Project report uploaded', Boolean(project.files?.reportUrl)],
                    ['Presentation uploaded', Boolean(project.files?.pptUrl)],
                    ['Source code uploaded', Boolean(project.files?.codeZipUrl)],
                    ['Submission window open', isSubmissionWindowOpen],
                    ...(!project.stageWorkflowEnabled ? [] : [
                      ['ABSTRACT approved', abstractApproved],
                      ['MIDTERM approved', midtermApproved],
                    ]),
                  ].map(([label, complete]) => (
                    <li key={label} className="flex items-center gap-2">
                      {complete ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertCircle className="h-4 w-4 text-amber-400" />}
                      <span className={complete ? 'text-slate-200' : 'text-amber-300'}>{label}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-slate-400">Exact-file comparison runs as part of final submission. It is not a pre-submission AI plagiarism scan.</p>
                <button
                  type="button"
                  onClick={handleSubmitProject}
                  disabled={submitting || !hasAllFiles || !canSubmitProject || !isSubmissionWindowOpen || !isLeader}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit Project
                </button>
              </div>
            )}

            {currentStep === 4 && (
            <fieldset disabled={!isDraft || !isLeader} className="contents">
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold">Project Details</h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Draft details can be updated until submission.</p>
                </div>
                {project.assignedFaculty ? (
                  <div className="text-right text-xs">
                    <p className="font-bold uppercase tracking-wider text-slate-400">Project Guide</p>
                    <p className="mt-1 font-semibold">{project.assignedFaculty.name}</p>
                    <p className="text-[var(--text-secondary)]">{project.assignedFaculty.department || 'Faculty'}</p>
                  </div>
                ) : (
                  <p className="text-right text-xs text-[var(--text-secondary)]">Project guide not assigned yet</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Project Abstract *</label>
                <textarea
                  value={projectDetails.abstract}
                  onChange={(e) => setProjectDetails((current) => ({ ...current, abstract: e.target.value }))}
                  maxLength={3000}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm"
                  required
                />
              </div>

              {[
                ['objectives', 'Objectives', 3000],
                ['proposedSolution', 'Proposed Solution', 3000],
                ['methodology', 'Methodology', 3000],
                ['expectedOutcome', 'Expected Outcome', 3000],
                ['technologies', 'Technology Stack', 1000],
              ].map(([field, label, maxLength]) => (
                <label key={field} className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  {label}
                  <textarea
                    value={projectDetails[field]}
                    onChange={(e) => setProjectDetails((current) => ({ ...current, [field]: e.target.value }))}
                    maxLength={maxLength}
                    rows={field === 'technologies' ? 2 : 3}
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                  />
                </label>
              ))}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  ['domain', 'Domain', 120],
                  ['keywords', 'Keywords', 500],
                ].map(([field, label, maxLength]) => (
                  <label key={field} className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    {label}
                    <input
                      value={projectDetails[field]}
                      onChange={(e) => setProjectDetails((current) => ({ ...current, [field]: e.target.value }))}
                      maxLength={maxLength}
                      className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm font-normal normal-case"
                    />
                  </label>
                ))}
              </div>

              {isDraft && isLeader && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={savingDraft || !title.trim() || !projectDetails.abstract.trim()}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {savingDraft ? 'Saving...' : 'Save Draft'}
                  </button>
                </div>
              )}
            </div>
            </fieldset>
            )}

            {/* Deliverables Section (File Uploads) */}
            {currentStep === 5 && (
            <div className="glass-panel p-6 rounded-2xl space-y-6">
              <ProjectStageSubmissions
                project={project}
                deadlines={deadlines}
                isLeader={isLeader}
                onChanged={async () => {
                  const refreshed = await getProjectById(project._id);
                  setProject(refreshed);
                }}
              />
              {!project.stageWorkflowEnabled && <>
              <div>
                <h3 className="text-base font-bold">Project Deliverables</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Exactly three logical deliverables are required for final submission.
                </p>
              </div>

              {/* Deliverable 1: Report (PDF) */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">1. Project Report (PDF)</p>
                      <p className="text-xs text-slate-400">Formal SRS, architecture, and evaluation results (.pdf)</p>
                    </div>
                  </div>
                  {project.files?.reportUrl ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-xs text-amber-400 font-semibold bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                      Pending
                    </span>
                  )}
                </div>

                {project.files?.reportUrl && (
                  <div className="flex items-center justify-between text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                    <span className="font-mono text-slate-300 truncate max-w-xs">{project.files.reportName || 'report.pdf'}</span>
                    <AuthenticatedFileDownload
                      projectId={project._id}
                      purpose="report"
                      filename={project.files.reportName || 'report.pdf'}
                      className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" /> View / Download
                    </AuthenticatedFileDownload>
                  </div>
                )}

                {canUploadSubmissionFiles && isLeader && (
                  <div className="flex items-center gap-3">
                    <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2">
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingReport ? 'Uploading...' : project.files?.reportUrl ? 'Replace Report (PDF)' : 'Upload Report (PDF)'}
                      <input
                        type="file"
                        accept=".pdf"
                        onChange={(e) => handleFileUpload(e, 'report')}
                        disabled={uploadingReport}
                        className="hidden"
                      />
                    </label>
                    {uploadingReport && (
                      <span className="text-xs text-blue-400 font-mono">
                        {uploadProgress.report}%
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Deliverable 2: Presentation Slides (PPT/PPTX) */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">2. Presentation Slides (PPT / PPTX)</p>
                      <p className="text-xs text-slate-400">Defense presentation slide deck (.ppt, .pptx)</p>
                    </div>
                  </div>
                  {project.files?.pptUrl ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-xs text-amber-400 font-semibold bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                      Pending
                    </span>
                  )}
                </div>

                {project.files?.pptUrl && (
                  <div className="flex items-center justify-between text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                    <span className="font-mono text-slate-300 truncate max-w-xs">{project.files.pptName || 'presentation.pptx'}</span>
                    <AuthenticatedFileDownload
                      projectId={project._id}
                      purpose="presentation"
                      filename={project.files.pptName || 'presentation.pptx'}
                      className="text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" /> View / Download
                    </AuthenticatedFileDownload>
                  </div>
                )}

                {canUploadSubmissionFiles && isLeader && (
                  <div className="flex items-center gap-3">
                    <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2">
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingPpt ? 'Uploading...' : project.files?.pptUrl ? 'Replace Slides (PPT/PPTX)' : 'Upload Slides (PPT/PPTX)'}
                      <input
                        type="file"
                        accept=".ppt,.pptx"
                        onChange={(e) => handleFileUpload(e, 'presentation')}
                        disabled={uploadingPpt}
                        className="hidden"
                      />
                    </label>
                    {uploadingPpt && (
                      <span className="text-xs text-indigo-400 font-mono">
                        {uploadProgress.presentation}%
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Deliverable 3: Source Code (ZIP) */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">3. Source Code Archive (ZIP)</p>
                      <p className="text-xs text-slate-400">Complete codebase bundled as compressed archive (.zip)</p>
                    </div>
                  </div>
                  {project.files?.codeZipUrl ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-xs text-amber-400 font-semibold bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                      Pending
                    </span>
                  )}
                </div>

                {project.files?.codeZipUrl && (
                  <div className="flex items-center justify-between text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                    <span className="font-mono text-slate-300 truncate max-w-xs">{project.files.codeZipName || 'source.zip'}</span>
                    <AuthenticatedFileDownload
                      projectId={project._id}
                      purpose="source"
                      filename={project.files.codeZipName || 'source.zip'}
                      className="text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" /> View / Download
                    </AuthenticatedFileDownload>
                  </div>
                )}

                {canUploadSubmissionFiles && isLeader && (
                  <div className="flex items-center gap-3">
                    <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2">
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingCode ? 'Uploading...' : project.files?.codeZipUrl ? 'Replace Source (ZIP)' : 'Upload Source (ZIP)'}
                      <input
                        type="file"
                        accept=".zip"
                        onChange={(e) => handleFileUpload(e, 'source')}
                        disabled={uploadingCode}
                        className="hidden"
                      />
                    </label>
                    {uploadingCode && (
                      <span className="text-xs text-purple-400 font-mono">
                        {uploadProgress.source}%
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Submit Final Action */}
              {canSubmitProject && isLeader && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-xs text-slate-400">
                    {hasAllFiles
                      ? 'All required deliverables are uploaded. Continue to Review & Submit when ready.'
                      : 'Upload the report, presentation, and source code before reviewing your submission.'}
                  </p>
                </div>
              )}
              </>}
            </div>
            )}
          </div>

          {/* Right Column: Team Management */}
          {currentStep === 2 && (
            <div className="lg:col-span-4 space-y-6">
              <div className="glass-panel p-6 rounded-2xl space-y-4">
                <h3 className="font-bold text-sm uppercase tracking-wider text-slate-400">Project Team</h3>

                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">L</div>
                  <div>
                    <p className="text-xs font-semibold text-white">{project.leader?.name || user?.name}</p>
                    <p className="text-[10px] text-blue-400 uppercase font-bold">Team Leader</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Accepted Members</p>
                  {project.teamMembers?.filter(m => (m._id || m) !== (project.leader?._id || project.leader)).length > 0 ? (
                    project.teamMembers
                      .filter(m => (m._id || m) !== (project.leader?._id || project.leader))
                      .map(m => (
                        <div key={m._id || m} className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200">{m.name || 'Student Member'}</span>
                          <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded">Active</span>
                        </div>
                      ))
                  ) : (
                    <p className="text-xs text-slate-500 italic">No additional team members yet.</p>
                  )}
                </div>

                {canInviteTeamMembers && (
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Invite Team Member</p>
                    <form onSubmit={handleSendInvitation} className="space-y-2">
                      <input
                        type="text"
                        value={inviteEmail}
                        onChange={(e) => { setInviteEmail(e.target.value); setInvitationError(''); }}
                        placeholder="Student name, roll number, or email"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        required
                      />
                      {invitationError && <p role="alert" className="text-xs text-red-300">{invitationError}</p>}
                      <button
                        type="submit"
                        disabled={inviting || !inviteEmail.trim()}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Send Invitation
                      </button>
                    </form>
                  </div>
                )}
                {isLeader && !canInviteTeamMembers && <p className="text-xs text-[var(--text-secondary)]">{invitationAvailabilityMessage}</p>}

                {leaderInvitations.length > 0 && (
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Invitation History</p>
                    {renderInvitationHistory()}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 ${currentStep === 2 ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
            <button
              type="button"
              onClick={() => goToStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
            >
              Back
            </button>
            <div className="flex items-center gap-3">
              {isDraft && isLeader && (
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={savingDraft || !title.trim() || !projectDetails.abstract.trim()}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {savingDraft ? 'Saving...' : 'Save Draft'}
                </button>
              )}
              {currentStep < submissionStepCount ? (
                <button
                  type="button"
                  onClick={() => goToStep(Math.min(submissionStepCount, currentStep + 1))}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmitProject}
                  disabled={submitting || !hasAllFiles || !canSubmitProject || !isSubmissionWindowOpen || !isLeader}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit Project
                </button>
              )}
            </div>
          </div>
        </div>
        </>
      )}

      {showInviteModal && project && isLeader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-team-member-title"
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="invite-team-member-title" className="text-xl font-bold">Invite Team Member</h2>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSendInvitation} className="mt-4 space-y-4">
              <label className="block text-sm font-semibold text-slate-200">
                College Email / Roll Number
                <input
                  type="text"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInvitationError(''); }}
                  placeholder="Search by name, college email, or roll number"
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
              </label>
              {invitationError && <p role="alert" className="text-sm text-red-300">{invitationError}</p>}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviting ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showSubmitConfirmation && project && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-confirmation-title"
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <h2 id="submit-confirmation-title" className="text-xl font-bold">Submit Project?</h2>
            <p className="mt-2 text-sm text-slate-300">
              Once submitted, the project will be locked for editing unless an administrator enables changes.
            </p>

            <div className="mt-5 space-y-3 text-sm">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Project</p>
                <p className="mt-1 font-semibold">{project.title}</p>
                <p className="text-xs text-slate-400">{project.projectType?.replaceAll('_', ' ') || 'Project'} · {project.cohort || project.deadline?.batch || 'Cohort not set'}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Team</p>
                <p className="mt-1">{(project.teamMembers || []).map((member) => member.name || (member._id === user?._id ? user.name : 'Team member')).join(', ') || user?.name}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Guide</p>
                <p className="mt-1">{project.assignedFaculty?.name || 'Not assigned'}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Uploaded Documents</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-300">
                  <li>Project report: {project.files?.reportName || 'Not uploaded'}</li>
                  <li>Presentation: {project.files?.pptName || 'Not uploaded'}</li>
                  <li>Source code: {project.files?.codeZipName || 'Not uploaded'}</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Submission Deadline</p>
                <p className="mt-1">
                  {project.deadline?.submissionEndDate
                    ? new Date(project.deadline.submissionEndDate).toLocaleString()
                    : 'Deadline details unavailable'}
                </p>
              </div>

              <div className="border-t border-slate-700 pt-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Submission Checklist</p>
                <ul className="mt-2 space-y-2">
                  {[
                    { label: 'Project title and abstract completed', complete: Boolean(project.title?.trim() && project.abstract?.trim()) },
                    { label: 'Team membership confirmed', complete: Boolean(project.teamMembers?.length) && leaderInvitations.every((invitation) => invitation.status !== 'pending') },
                    { label: 'Project guide assigned', complete: Boolean(project.assignedFaculty) },
                    { label: 'Project report uploaded', complete: Boolean(project.files?.reportUrl) },
                    { label: 'Presentation uploaded', complete: Boolean(project.files?.pptUrl) },
                    { label: 'Source code uploaded', complete: Boolean(project.files?.codeZipUrl) },
                    {
                      label: 'Submission deadline is open',
                      complete: deadlines.some((item) =>
                        String(item._id) === String(project.deadline?._id || project.deadline)
                        && item.isActive
                        && new Date(item.submissionEndDate) >= new Date()
                      ),
                    },
                  ].map((item) => (
                    <li key={item.label} className="flex items-center gap-2 text-xs">
                      {item.complete
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        : <AlertCircle className="h-4 w-4 text-amber-400" />}
                      <span className={item.complete ? 'text-slate-200' : 'text-amber-300'}>{item.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-slate-400">Exact-file comparison is performed by the server when you confirm submission.</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitConfirmation(false)}
                disabled={submitting}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSubmitProject}
                disabled={submitting || !hasAllFiles}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Confirm Submission'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
