import React, { useState, useEffect } from 'react';
import { submitEvaluation, getEvaluationsByProject } from '../../services/evaluationService';
import {
  requestProjectRevision,
  grantProjectRevisionAccess,
  reviewProposal,
  reviewStageSubmission,
  grantStageRevisionAccess,
  respondToProjectRevisionAccessRequest,
  downloadProjectFile,
} from '../../services/projectService';
import ProjectWorkspace from '../../components/ProjectWorkspace';
import AuthenticatedFileDownload from '../../components/AuthenticatedFileDownload';
import ReportOriginalityPanel from '../../components/ReportOriginalityPanel';
import { hasRevisionPermissionItems } from '../../utils/revisionAccess';
import { PHASE_CRITERIA } from '../../utils/constants';
import { getSimilarityDisplayState } from '../../utils/similarityDisplay';
import { getReviewModalState, getSelectedVersionFileReference, isValidReviewSubmission } from '../../utils/reviewSelection';
import { X, CheckCircle, Award, Loader2, AlertCircle } from 'lucide-react';

const REVIEW_LABELS = {
  abstract: 'Review 1 · Proposal and initial project',
  midterm: 'Review 2 · Architecture and design',
  final: 'Review 3 · Final project demonstration',
};

const REVISION_FIELDS = [
  ['title', 'Project title'],
  ['abstract', 'Abstract'],
  ['problemStatement', 'Problem statement'],
  ['objectives', 'Objectives'],
  ['methodology', 'Methodology'],
  ['technologies', 'Technologies'],
  ['expectedOutcome', 'Expected outcome'],
  ['description', 'Description'],
  ['domain', 'Domain'],
  ['keywords', 'Keywords'],
  ['proposedSolution', 'Proposed solution'],
];

export default function EvaluateModal({ isOpen, onClose, project, submission, proposalOnly = false, accessRequestOnly = false, onSuccess }) {
  const [phase, setPhase] = useState('abstract');
  const [criteriaScores, setCriteriaScores] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [evaluationSaved, setEvaluationSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionDeadline, setRevisionDeadline] = useState('');
  const [revisionFields, setRevisionFields] = useState(['methodology']);
  const [revisionRequest, setRevisionRequest] = useState(project?.revisionRequest || null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionFileTypes, setRevisionFileTypes] = useState([]);
  const [accessGrantFields, setAccessGrantFields] = useState([]);
  const [accessGrantFileTypes, setAccessGrantFileTypes] = useState([]);
  const [studentAccessRequest, setStudentAccessRequest] = useState(project?.revisionAccessRequest || null);
  const [activeSubmissionState, setActiveSubmission] = useState(submission || null);
  const [stageFeedback, setStageFeedback] = useState('');
  const [stageRevisionFileTypes, setStageRevisionFileTypes] = useState(['report']);
  const [stageDueDate, setStageDueDate] = useState('');
  const [stageBusy, setStageBusy] = useState(false);
  const submissionCandidate = activeSubmissionState || submission || null;
  const activeSubmission = isValidReviewSubmission(submissionCandidate) ? submissionCandidate : null;
  const modalState = getReviewModalState({ isOpen, project, submission: activeSubmission, proposalOnly, accessRequestOnly });
  const reportFile = getSelectedVersionFileReference(project?._id, activeSubmission, 'report');
  const presentationFile = getSelectedVersionFileReference(project?._id, activeSubmission, 'presentation');
  const sourceFile = getSelectedVersionFileReference(project?._id, activeSubmission, 'source');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState('');

  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    if (!isOpen || proposalOnly || accessRequestOnly) {
      setPdfPreviewUrl('');
      setPdfPreviewError('');
      setPdfPreviewLoading(false);
      return undefined;
    }
    if (!reportFile) {
      setPdfPreviewUrl('');
      setPdfPreviewError('No PDF report is available for this submitted version.');
      setPdfPreviewLoading(false);
      return undefined;
    }

    setPdfPreviewUrl('');
    setPdfPreviewError('');
    setPdfPreviewLoading(true);
    downloadProjectFile(reportFile.projectId, reportFile.purpose, reportFile.versionNumber, reportFile.phase)
      .then((file) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
        setPdfPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setPdfPreviewError('Unable to load the submitted PDF. Use Download PDF to try again.');
      })
      .finally(() => {
        if (!disposed) setPdfPreviewLoading(false);
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, proposalOnly, accessRequestOnly, reportFile?.projectId, reportFile?.purpose, reportFile?.phase, reportFile?.versionNumber, activeSubmission?.files?.reportUrl]);

  // Initialize/reset scores when phase or project changes
  useEffect(() => {
    let cancelled = false;
    if (project) {
      setActiveSubmission(submission || null);
      setStageRevisionFileTypes(submission?.revisionFileTypes?.length ? submission.revisionFileTypes : ['report']);
      const evaluationPhase = PHASE_CRITERIA[submission?.phase] ? submission.phase : PHASE_CRITERIA[phase] ? phase : 'abstract';
      setPhase(evaluationPhase);
      const activeCriteria = PHASE_CRITERIA[evaluationPhase];
      const initialScores = activeCriteria.map(c => ({
        criteriaName: c.name,
        maxMarks: c.maxMarks,
        scoredMarks: 0,
      }));
      setCriteriaScores(initialScores);
      setFeedback('');
      setStageFeedback('');
      setEvaluationSaved(false);
      setError(null);
      setRevisionRequest(project.revisionRequest || null);
      setRevisionReason(project.revisionRequest?.reason || '');
      setRevisionDeadline('');
      setRevisionFields(project.revisionRequest?.editableFields?.length ? project.revisionRequest.editableFields : ['methodology']);
      setRevisionFileTypes(project.revisionRequest?.fileTypes || []);
      setAccessGrantFields(project.revisionAccessRequest?.editableFields || []);
      setAccessGrantFileTypes(project.revisionAccessRequest?.fileTypes || []);
      setStudentAccessRequest(project.revisionAccessRequest || null);
      
      // Load previous draft/eval if it exists for this project and phase
      const fetchExistingEval = async () => {
        if (proposalOnly || accessRequestOnly) return;
        try {
          const evals = await getEvaluationsByProject(project._id);
          const currentPhaseEval = evals.find((evaluation) => (
            evaluation.phase === evaluationPhase
            && (!submission || Number(evaluation.submissionVersion || 0) === Number(submission.version || 0))
          ));
          if (cancelled) return;
          if (currentPhaseEval) {
            setCriteriaScores(currentPhaseEval.scores);
            setFeedback(currentPhaseEval.feedback || '');
            setEvaluationSaved(true);
          } else {
            setCriteriaScores(PHASE_CRITERIA[evaluationPhase].map((criterion) => ({
              criteriaName: criterion.name,
              maxMarks: criterion.maxMarks,
              scoredMarks: 0,
            })));
          }
        } catch (err) {
          console.warn('No previous evaluation found for this phase.');
        }
      };
      fetchExistingEval();
    }
    return () => { cancelled = true; };
  }, [project, phase, submission, proposalOnly, accessRequestOnly]);

  if (modalState === 'closed') return null;
  if (modalState === 'project-unavailable') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
        <section role="alertdialog" aria-modal="true" aria-labelledby="evaluation-unavailable-title" className="glass-panel w-full max-w-md rounded-xl p-6">
          <h2 id="evaluation-unavailable-title" className="text-lg font-bold">Review unavailable</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">The project details for this review could not be loaded. Refresh the review queue and try again.</p>
          <button type="button" onClick={onClose} className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Close</button>
        </section>
      </div>
    );
  }
  if (modalState === 'submission-unavailable') {
    return (
      <div className="fixed inset-y-4 left-4 right-4 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm md:left-[calc(18rem+1rem)]" role="presentation">
        <section role="alertdialog" aria-modal="true" aria-labelledby="submission-unavailable-title" className="glass-panel w-full max-w-md rounded-xl p-6">
          <h2 id="submission-unavailable-title" className="text-lg font-bold">Formal review unavailable</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">A valid submitted review version with a phase, version number, and status was not provided. Refresh the formal review queue and reopen the submission.</p>
          <button type="button" onClick={onClose} className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Close</button>
        </section>
      </div>
    );
  }

  const reportOriginality = activeSubmission
    ? activeSubmission.reportOriginality
    : phase === 'final' ? project.reportOriginality : null;
  const proposalDetails = [
    ['Abstract', project.abstract],
    ['Problem statement', project.problemStatement || project.description],
    ['Objectives', project.objectives],
    ['Methodology', project.methodology],
    ['Proposed solution', project.proposedSolution],
    ['Technologies', project.technologies],
    ['Expected outcome', project.expectedOutcome],
    ['Domain', project.domain],
    ['Keywords', project.keywords],
  ].filter(([, value]) => typeof value === 'string' && value.trim());

  const handleScoreChange = (index, value) => {
    const updated = [...criteriaScores];
    updated[index].scoredMarks = Math.max(0, Math.min(updated[index].maxMarks, Number(value)));
    setCriteriaScores(updated);
  };

  const totalScore = criteriaScores.reduce((acc, curr) => acc + Number(curr.scoredMarks), 0);
  const maxTotalScore = (PHASE_CRITERIA[phase] || PHASE_CRITERIA.abstract)
    .reduce((acc, curr) => acc + curr.maxMarks, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (proposalOnly || accessRequestOnly) return;
    setError(null);
    setSubmitting(true);

    try {
      await submitEvaluation({
        projectId: project._id,
        phase: activeSubmission?.phase || phase,
        submissionVersion: activeSubmission?.version,
        scores: criteriaScores,
        feedback,
        isPublished: true, // Auto publish on submit
      });
      setEvaluationSaved(true);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit evaluation details.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveProposal = async () => {
    setError(null);
    setRevisionBusy(true);
    try {
      await reviewProposal(project._id, 'accepted');
      if (onSuccess) await onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to approve this proposal.');
    } finally {
      setRevisionBusy(false);
    }
  };

  const handleRejectProposal = async () => {
    if (!revisionReason.trim()) return;
    setError(null);
    setRevisionBusy(true);
    try {
      await reviewProposal(project._id, 'rejected', revisionReason.trim());
      if (onSuccess) await onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reject this proposal.');
    } finally {
      setRevisionBusy(false);
    }
  };

  const handleStageDecision = async (decision) => {
    if (!activeSubmission?.phase || !Number.isInteger(Number(activeSubmission.version))) return;
    setError(null);
    setStageBusy(true);
    try {
      const updated = await reviewStageSubmission(project._id, activeSubmission.phase, activeSubmission.version, {
        decision,
        feedback: stageFeedback,
        revisionFileTypes: decision === 'changes_requested' ? stageRevisionFileTypes : [],
        revisionDueDate: decision === 'changes_requested' && stageDueDate
          ? new Date(stageDueDate).toISOString()
          : undefined,
      });
      setActiveSubmission(updated);
      if (onSuccess) await onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to review this stage version.');
    } finally {
      setStageBusy(false);
    }
  };

  const handleGrantStageAccess = async () => {
    if (!activeSubmission?.phase || !Number.isInteger(Number(activeSubmission.version))) return;
    setError(null);
    setStageBusy(true);
    try {
      const updated = await grantStageRevisionAccess(project._id, activeSubmission.phase, activeSubmission.version);
      setActiveSubmission(updated);
      if (onSuccess) await onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to grant stage revision access.');
    } finally {
      setStageBusy(false);
    }
  };

  const handleRequestRevision = async () => {
    setError(null);
    setRevisionBusy(true);
    try {
      const result = await requestProjectRevision(project._id, {
        reason: revisionReason,
        editableFields: revisionFields,
        fileTypes: revisionFileTypes,
        phase: proposalOnly ? 'proposal' : undefined,
        revisionDeadline: revisionDeadline ? new Date(revisionDeadline).toISOString() : undefined,
      });
      setRevisionRequest(result.revisionRequest || result.project?.revisionRequest);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to request a project revision.');
    } finally {
      setRevisionBusy(false);
    }
  };

  const handleGrantRevisionAccess = async () => {
    setError(null);
    setRevisionBusy(true);
    try {
      const updated = await grantProjectRevisionAccess(project._id);
      setRevisionRequest(updated.revisionRequest || updated.project?.revisionRequest);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to grant revision access.');
    } finally {
      setRevisionBusy(false);
    }
  };

  const handleRespondToAccessRequest = async (decision) => {
    setError(null);
    setRevisionBusy(true);
    try {
      const result = await respondToProjectRevisionAccessRequest(project._id, {
        decision,
        editableFields: accessGrantFields,
        fileTypes: accessGrantFileTypes,
        revisionDeadline: revisionDeadline ? new Date(revisionDeadline).toISOString() : undefined,
      });
      setStudentAccessRequest(result.request);
      setRevisionRequest(result.revisionRequest || null);
      if (onSuccess) await onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || `Unable to ${decision} revision permission.`);
    } finally {
      setRevisionBusy(false);
    }
  };

  const toggleRevisionField = (field) => {
    setRevisionFields((current) => current.includes(field)
      ? current.filter((item) => item !== field)
      : [...current, field]);
  };

  const toggleRevisionFileType = (fileType) => {
    setRevisionFileTypes((current) => current.includes(fileType)
      ? current.filter((item) => item !== fileType)
      : [...current, fileType]);
  };

  return (
    <div className="fixed inset-y-4 left-4 right-4 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm md:left-[calc(18rem+1rem)]">
    <div className="faculty-evaluation-modal h-full w-full max-w-none glass-panel-glow rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 animate-in fade-in zoom-in-95 duration-200 flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-950/40">
          <div>
            <h3 className="text-lg font-bold">{project.title || 'Untitled project'}</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {accessRequestOnly ? 'Revision permission request' : proposalOnly ? 'Proposal review' : `${REVIEW_LABELS[activeSubmission?.phase || phase]}${activeSubmission?.version ? ` · Version ${activeSubmission.version}` : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Project Details Panel (Left) */}
          <div className="md:col-span-7 min-w-0 space-y-4 border-r border-slate-200 dark:border-slate-800 pr-0 md:pr-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Proposal details</span>
              {proposalDetails.length > 0 ? (
                <dl className="mt-2 space-y-3 text-xs text-slate-300">
                  {proposalDetails.map(([label, value]) => (
                    <div key={label}>
                      <dt className="font-semibold text-slate-400">{label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap leading-relaxed">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="mt-2 text-xs text-slate-500">Proposal details are not available.</p>}
              {activeSubmission && (
                <p className="mt-2 text-xs font-semibold text-blue-300">
                  {REVIEW_LABELS[activeSubmission.phase]} · V{activeSubmission.version} · {activeSubmission.status.replace(/_/g, ' ')}
                </p>
              )}
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{accessRequestOnly ? 'Permission request' : proposalOnly ? 'Proposal review' : 'Submitted Assets'}</span>
              <div className="space-y-2 mt-2">
                {proposalOnly || accessRequestOnly ? (
                  <p className="text-xs text-slate-500 italic">{accessRequestOnly ? 'No formal review documents were submitted with this permission request.' : 'Proposal approval is separate from formal stage document submissions.'}</p>
                ) : reportFile ? (
                  <AuthenticatedFileDownload
                    {...reportFile}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-semibold text-blue-400 hover:text-blue-300 hover:bg-blue-500/5 transition-all"
                  >
                    <span>Download PDF</span>
                  </AuthenticatedFileDownload>
                ) : (
                  <p className="text-xs text-slate-500 italic">No Report file submitted</p>
                )}

                {!proposalOnly && !accessRequestOnly && presentationFile ? (
                  <div>
                    <AuthenticatedFileDownload
                      {...presentationFile}
                      className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/5 transition-all"
                    >
                      <span>Download Presentation (PPT/PPTX)</span>
                    </AuthenticatedFileDownload>
                    <p className="mt-1 text-[10px] text-slate-500">Browser preview is not supported for this file. Download it to review.</p>
                  </div>
                ) : !proposalOnly && !accessRequestOnly && (
                  <p className="text-xs text-slate-500 italic">No Slides file submitted</p>
                )}

                {!proposalOnly && !accessRequestOnly && sourceFile ? (
                  <AuthenticatedFileDownload
                    {...sourceFile}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-semibold text-purple-400 hover:text-purple-300 hover:bg-purple-500/5 transition-all"
                  >
                    <span>Download Source (ZIP)</span>
                  </AuthenticatedFileDownload>
                ) : !proposalOnly && !accessRequestOnly && (
                  <p className="text-xs text-slate-500 italic">No Source code ZIP submitted</p>
                )}
                {!proposalOnly && !accessRequestOnly && (
                  <section className="mt-4 space-y-2 border-t border-slate-800 pt-3" aria-label="Submitted PDF preview">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Report PDF{activeSubmission?.version !== undefined ? ` · V${activeSubmission.version}` : ''}
                      </h4>
                      {pdfPreviewUrl && (
                        <a href={pdfPreviewUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-400 hover:text-blue-300">
                          Open PDF in new tab
                        </a>
                      )}
                    </div>
                    {pdfPreviewLoading ? (
                      <p role="status" className="flex items-center gap-2 rounded-md bg-slate-950 p-4 text-xs text-slate-300">
                        <Loader2 className="h-4 w-4 animate-spin" />Loading the selected report version…
                      </p>
                    ) : pdfPreviewError ? (
                      <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">{pdfPreviewError}</p>
                    ) : pdfPreviewUrl ? (
                      <iframe
                        title={`Submitted report ${activeSubmission?.phase || ''} version ${activeSubmission?.version ?? ''}`}
                        src={pdfPreviewUrl}
                        className="h-[28rem] w-full rounded-md border border-slate-700 bg-white"
                      />
                    ) : null}
                  </section>
                )}
                {!proposalOnly && !accessRequestOnly && (activeSubmission?.deploymentUrl || (phase === 'final' && project.deploymentUrl)) && (
                  <a
                    href={activeSubmission?.deploymentUrl || project.deploymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-emerald-800 bg-slate-950 p-2.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200"
                  >
                    Open deployed project
                  </a>
                )}
              </div>
            </div>

            <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Project team</h4>
              <p className="text-xs"><strong>Leader:</strong> {project.leader?.name || 'Not listed'} {project.leader?.rollNumber ? `(${project.leader.rollNumber})` : ''}</p>
              {(project.teamMembers || []).filter((member) => String(member?._id || member) !== String(project.leader?._id || project.leader)).length > 0
                ? project.teamMembers
                  .filter((member) => String(member?._id || member) !== String(project.leader?._id || project.leader))
                  .map((member) => <p key={member?._id || member} className="text-xs text-slate-300">{member?.name || 'Team member'}{member?.rollNumber ? ` · ${member.rollNumber}` : ''}</p>)
                : <p className="text-xs text-slate-500">No additional accepted members.</p>}
              <p className="text-xs"><strong>Batch / section:</strong> {project.batch || project.deadline?.batch || project.leader?.batch || 'Not listed'} · {project.section || project.leader?.section || 'Section not listed'}</p>
              <p className="text-xs"><strong>Guide:</strong> {project.assignedFaculty?.name || 'Not assigned'}{project.assignedFaculty?.department ? ` · ${project.assignedFaculty.department}` : ''}</p>
            </section>

            {project.uniquenessCheck && (
              <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Proposal similarity evidence</h4>
                <p className="text-xs">{getSimilarityDisplayState(project).label}</p>
                <p className="text-xs text-slate-400">{project.uniquenessCheck.algorithm || 'Algorithm not recorded'} · {project.uniquenessCheck.scoreMethod || 'Score method not recorded'}</p>
                {(project.uniquenessCheck.matches || []).map((match) => (
                  <div key={match.projectId} className="border-t border-slate-800 pt-2 text-xs">
                    <p className="font-semibold">{match.title || 'Historical project'} · {match.similarityScore ?? 'N/A'}% text similarity</p>
                    <p className="mt-1 text-slate-400">{match.explanation || match.evidence || 'No evidence recorded.'}</p>
                    <p className="mt-1 text-slate-500">Sentence-BERT: {getSimilaritySemanticLabel(match)}</p>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500">Portal proposal/report comparison only; TF-IDF/cosine overlap is not a plagiarism verdict.</p>
              </section>
            )}

            {project.stageSubmissions?.length > 0 && (
              <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Submitted version history</h4>
                {[...project.stageSubmissions]
                  .sort((left, right) => left.phase.localeCompare(right.phase) || Number(left.version) - Number(right.version))
                  .map((version) => (
                    <div key={`${version.phase}-${version.version}`} className="border-t border-slate-800 pt-2 text-xs">
                      <p className="font-semibold">{REVIEW_LABELS[version.phase]} · V{version.version} · {version.status.replace(/_/g, ' ')}</p>
                      <p className="mt-1 text-slate-400">Submitted {version.submittedAt ? new Date(version.submittedAt).toLocaleString() : 'date unavailable'}{version.reviewedAt ? ` · reviewed ${new Date(version.reviewedAt).toLocaleString()}` : ''}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {[
                          ['report', 'reportUrl', 'reportName'],
                          ['presentation', 'pptUrl', 'pptName'],
                          ['source', 'codeZipUrl', 'codeZipName'],
                        ].filter(([, urlField]) => version.files?.[urlField]).map(([purpose, , nameField]) => (
                            <AuthenticatedFileDownload
                            key={purpose}
                            projectId={project._id}
                            purpose={purpose}
                            phase={version.phase}
                            versionNumber={version.version}
                            filename={version.files[nameField] || `${version.phase}-${purpose}`}
                            className="font-semibold text-blue-400 hover:text-blue-300"
                          >
                            Open {version.files[nameField] || purpose}
                          </AuthenticatedFileDownload>
                        ))}
                      </div>
                      {version.rubricEvaluation?.isPublished && <p className="mt-1">Marks: {version.rubricEvaluation.totalScore} · {version.rubricEvaluation.feedback || 'No evaluation feedback'}</p>}
                      {version.feedback && <p className="mt-1 text-amber-200">Stage feedback: {version.feedback}</p>}
                    </div>
                  ))}
              </section>
            )}

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Team Size:</span>
                <span className="font-semibold">{project.teamMembers?.length} students</span>
              </div>
              {(() => {
                const display = getSimilarityDisplayState(project);
                return display.score !== null && display.score > 0 && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Integrity Match:</span>
                    <span className={`font-semibold ${display.score > 15 ? 'text-amber-500' : 'text-emerald-500'}`}>
                      {display.score}% matches detected
                    </span>
                  </div>
                );
              })()}
              <ReportOriginalityPanel analysis={reportOriginality} />

              <ProjectWorkspace project={{ ...project, revisionRequest }} />
            </div>
          </div>

          {/* Grading Rubric Panel (Right) */}
          <form onSubmit={handleSubmit} className="md:col-span-5 min-w-0 space-y-5">
            {error && (
              <div className="p-3 text-xs rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex gap-2 items-center">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}

            {!submission && !accessRequestOnly && <section className="space-y-3 border-b border-slate-200 pb-5 dark:border-slate-800">
              <div>
                <h4 className="text-sm font-bold">{proposalOnly ? 'Proposal decision' : 'Revision access'}</h4>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {revisionRequest?.status === 'granted' && hasRevisionPermissionItems(revisionRequest)
                    ? 'Revision access is open for the approved fields and files.'
                    : revisionRequest?.status === 'granted'
                      ? 'This saved grant has no permitted fields or files. Create a corrected request before students make changes.'
                      : revisionRequest?.status === 'resolved'
                      ? 'The latest revision has been resubmitted; access is closed.'
                      : 'Request specific changes, then explicitly grant the student team access.'}
                </p>
              </div>
              {(revisionRequest?.status !== 'granted' || !hasRevisionPermissionItems(revisionRequest)) && revisionRequest?.status !== 'resolved' && (
                <>
                  <textarea
                    value={revisionReason}
                    onChange={(event) => setRevisionReason(event.target.value)}
                    rows={3}
                    maxLength={2000}
                    aria-label="Revision reason"
                    placeholder={proposalOnly ? 'Faculty review feedback; required to request changes or reject.' : 'Explain the changes required from the project team'}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ['title', 'Project title'],
                      ['abstract', 'Abstract'],
                      ['problemStatement', 'Problem statement'],
                      ['objectives', 'Objectives'],
                      ['methodology', 'Methodology'],
                      ['technologies', 'Technologies'],
                      ['expectedOutcome', 'Expected outcome'],
                      ['description', 'Description'],
                      ['domain', 'Domain'],
                      ['keywords', 'Keywords'],
                      ['proposedSolution', 'Proposed solution'],
                    ].map(([field, label]) => (
                      <label key={field} className="flex items-center gap-2 text-slate-300">
                        <input type="checkbox" checked={revisionFields.includes(field)} onChange={() => toggleRevisionField(field)} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {!proposalOnly && <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                    {[
                      ['report', 'Report PDF'],
                      ['presentation', 'Presentation'],
                      ['source', 'Source ZIP'],
                    ].map(([fileType, label]) => (
                      <label key={fileType} className="flex items-center gap-2 text-slate-300">
                        <input type="checkbox" checked={revisionFileTypes.includes(fileType)} onChange={() => toggleRevisionFileType(fileType)} />
                        {label}
                      </label>
                    ))}
                  </div>}
                  <label className="block max-w-sm text-xs font-medium text-slate-300">
                    Revision deadline (optional extension)
                    <input
                      type="datetime-local"
                      value={revisionDeadline}
                      onChange={(event) => setRevisionDeadline(event.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleRequestRevision} disabled={revisionBusy || !revisionReason.trim() || (!revisionFields.length && !revisionFileTypes.length)} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-50">
                      {proposalOnly ? 'Request proposal changes' : 'Request revision'}
                    </button>
                    {revisionRequest?.status === 'pending' && (
                      <button type="button" onClick={handleGrantRevisionAccess} disabled={revisionBusy || !hasRevisionPermissionItems(revisionRequest)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                        Grant student access
                      </button>
                    )}
                    {proposalOnly && (
                      <>
                        <button type="button" onClick={handleApproveProposal} disabled={revisionBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                          {revisionBusy ? 'Saving...' : 'Approve Proposal'}
                        </button>
                        <button type="button" onClick={handleRejectProposal} disabled={revisionBusy || !revisionReason.trim()} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-50">
                          Reject Proposal
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </section>}

            {studentAccessRequest?.status === 'pending' && (
              <section className="space-y-3 border-b border-slate-200 pb-5 dark:border-slate-800">
                <div>
                  <h4 className="text-sm font-bold">Student revision permission request</h4>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{studentAccessRequest.reason}</p>
                </div>
                <fieldset className="grid grid-cols-2 gap-2 text-xs">
                  <legend className="col-span-2 mb-2 font-semibold text-slate-300">Fields to authorize</legend>
                  {REVISION_FIELDS.map(([field, label]) => (
                    <label key={field} className="flex items-center gap-2 text-slate-300">
                      <input type="checkbox" checked={accessGrantFields.includes(field)} onChange={() => setAccessGrantFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])} />
                      {label}
                    </label>
                  ))}
                </fieldset>
                {project.stageWorkflowEnabled ? (
                  <p className="text-xs text-[var(--text-secondary)]">Formal review files are revised through their submitted review version. This Workspace request can authorize proposal fields only.</p>
                ) : <fieldset className="flex flex-wrap gap-4 text-xs">
                  <legend className="mb-2 w-full font-semibold text-slate-300">Files to authorize</legend>
                  {[
                    ['report', 'Report PDF'],
                    ['presentation', 'Presentation'],
                    ['source', 'Source ZIP'],
                  ].map(([fileType, label]) => (
                    <label key={fileType} className="flex items-center gap-2 text-slate-300">
                      <input type="checkbox" checked={accessGrantFileTypes.includes(fileType)} onChange={() => setAccessGrantFileTypes((current) => current.includes(fileType) ? current.filter((item) => item !== fileType) : [...current, fileType])} />
                      {label}
                    </label>
                  ))}
                </fieldset>}
                <label className="block max-w-sm text-xs font-medium text-slate-300">
                  Revision deadline (optional)
                  <input type="datetime-local" value={revisionDeadline} onChange={(event) => setRevisionDeadline(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleRespondToAccessRequest('grant')} disabled={revisionBusy || (!accessGrantFields.length && !accessGrantFileTypes.length)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Grant selected access</button>
                  <button type="button" onClick={() => handleRespondToAccessRequest('deny')} disabled={revisionBusy} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-50">Deny request</button>
                </div>
              </section>
            )}

            {activeSubmission && (
              <section className="space-y-3 border-b border-slate-200 pb-5 dark:border-slate-800">
                <div>
                  <h4 className="text-sm font-bold">{REVIEW_LABELS[activeSubmission.phase]} · Version {activeSubmission.version} sign-off</h4>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {activeSubmission.status === 'resubmitted'
                      ? 'This revised version is awaiting review. The previous revision grant is closed; reviewer access remains available.'
                      : `Current state: ${activeSubmission.status.replace(/_/g, ' ')}.`}
                  </p>
                  {activeSubmission.feedback && <p className="mt-2 text-xs text-amber-200">Previous feedback: {activeSubmission.feedback}</p>}
                </div>
                {['submitted', 'resubmitted'].includes(activeSubmission.status) && (
                  <>
                    <textarea
                      value={stageFeedback}
                      onChange={(event) => setStageFeedback(event.target.value)}
                      rows={3}
                      maxLength={2000}
                      aria-label="Stage review feedback"
                      placeholder="Feedback tied to this phase and version"
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                    />
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-semibold text-slate-300">Files the student may revise</legend>
                      {(activeSubmission.phase === 'final'
                        ? [['report', 'Report PDF'], ['presentation', 'Presentation'], ['source', 'Source ZIP'], ['deploymentUrl', 'Deployed project URL']]
                        : [['report', 'Report PDF'], ['presentation', 'Presentation']]
                      ).map(([fileType, label]) => (
                        <label key={fileType} className="mr-4 inline-flex items-center gap-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={stageRevisionFileTypes.includes(fileType)}
                            onChange={() => setStageRevisionFileTypes((current) => current.includes(fileType)
                              ? current.filter((item) => item !== fileType)
                              : [...current, fileType])}
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    <label className="block max-w-sm text-xs font-medium text-slate-300">
                      Revision due date (optional extension)
                      <input type="datetime-local" value={stageDueDate} onChange={(event) => setStageDueDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => handleStageDecision('changes_requested')} disabled={stageBusy || !stageFeedback.trim() || !stageRevisionFileTypes.length} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-50">Request changes</button>
                      <button type="button" onClick={() => handleStageDecision('approved')} disabled={stageBusy || !evaluationSaved} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve {activeSubmission.phase.toUpperCase()}</button>
                      {!evaluationSaved && <p className="w-full text-xs text-amber-300">Save the rubric evaluation before signing off this review.</p>}
                    </div>
                  </>
                )}
                {activeSubmission.status === 'changes_requested' && !activeSubmission.revisionAccessGranted && (
                  <button type="button" onClick={handleGrantStageAccess} disabled={stageBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Grant revision access</button>
                )}
                {activeSubmission.status === 'approved' && (
                  <p className="text-xs font-semibold text-emerald-300">Approved by {activeSubmission.reviewedBy?.name || 'assigned reviewer'} on {activeSubmission.reviewedAt ? new Date(activeSubmission.reviewedAt).toLocaleString() : 'date unavailable'}.</p>
                )}
              </section>
            )}

            {/* Select Grading Stage */}
            {!proposalOnly && !accessRequestOnly && !submission && <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Select Evaluation Phase
              </label>
              <div className="grid grid-cols-3 gap-2">
                {['abstract', 'midterm', 'final'].map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPhase(p)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      phase === p
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                        : 'border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400'
                    }`}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>}

            {/* Render Criteria sliders */}
            {!proposalOnly && !accessRequestOnly && <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-sm font-bold flex items-center gap-2 text-indigo-400">
                <Award className="w-4 h-4" />
                Rubric Scores · {REVIEW_LABELS[activeSubmission?.phase || phase]}
              </h4>
              
              {criteriaScores.map((score, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>{score.criteriaName}</span>
                    <span className="text-indigo-400 font-bold">{score.scoredMarks} / {score.maxMarks}</span>
                  </div>
                  <div className="flex gap-4 items-center">
                    <input
                      type="range"
                      min="0"
                      max={score.maxMarks}
                      value={score.scoredMarks}
                      onChange={(e) => handleScoreChange(index, e.target.value)}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <input
                      type="number"
                      min="0"
                      max={score.maxMarks}
                      value={score.scoredMarks}
                      onChange={(e) => handleScoreChange(index, e.target.value)}
                      className="w-14 px-2 py-1 text-center text-xs rounded-lg border border-slate-800 bg-slate-950 text-white focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>}

            {/* Actions & Feedback */}
            {!proposalOnly && !accessRequestOnly && <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Actionable Feedback & Notes
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-slate-800 bg-slate-950 text-xs focus:outline-none text-white focus:ring-1 focus:ring-blue-500"
                  placeholder="Provide guidance notes for student team adjustments..."
                  required
                />
              </div>

              {/* Total Score display */}
              <div className="p-3.5 rounded-xl border border-blue-500/10 bg-blue-500/5 flex justify-between items-center text-sm">
                <span className="font-semibold text-slate-400">Summed Total Marks:</span>
                <span className="font-extrabold text-blue-500 text-lg">
                  {totalScore} <span className="text-xs text-slate-500 font-normal">/ {maxTotalScore}</span>
                </span>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-800 hover:bg-slate-900 rounded-xl text-xs font-semibold cursor-pointer text-slate-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-blue-500/10 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Submit Marks</span>
                    </>
                  )}
                </button>
              </div>
            </div>}
          </form>
        </div>
      </div>
    </div>
  );
}
