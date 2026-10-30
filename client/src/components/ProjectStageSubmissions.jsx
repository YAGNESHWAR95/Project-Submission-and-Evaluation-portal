import { useState } from 'react';
import AuthenticatedFileDownload from './AuthenticatedFileDownload';
import ReportOriginalityPanel from './ReportOriginalityPanel';
import { saveStageDraft, submitStageDocument, uploadStageDocument } from '../services/projectService';
import { PHASE_CRITERIA } from '../utils/constants';
import { canEditStageControl, getConfirmedStageUpload, getStageSubmissionEligibility, getStageUploadGate, isStageRevisionItemAuthorized } from '../utils/stageSubmissionState';

const PHASES = [
  { phase: 'abstract', label: 'Review 1 · Proposal and initial project', description: 'Submit the initial project report and presentation.' },
  { phase: 'midterm', label: 'Review 2 · Architecture and design', description: 'Submit the updated report covering architecture, UML, database design, and implementation design, with its presentation.' },
  { phase: 'final', label: 'Review 3 · Final project demonstration', description: 'Submit the final report, presentation, source ZIP, and deployed project URL.' },
];

const FILES = [
  { purpose: 'report', label: 'Report PDF', accept: '.pdf,application/pdf', phases: ['abstract', 'midterm', 'final'] },
  { purpose: 'presentation', label: 'Presentation PPT/PPTX', accept: '.ppt,.pptx', phases: ['abstract', 'midterm', 'final'] },
  { purpose: 'source', label: 'Source ZIP', accept: '.zip,application/zip', phases: ['final'] },
];

const FILE_FIELDS = {
  report: { url: 'reportUrl', name: 'reportName' },
  presentation: { url: 'pptUrl', name: 'pptName' },
  source: { url: 'codeZipUrl', name: 'codeZipName' },
};

const getLatestSubmission = (submissions, phase) => (submissions || [])
  .filter((submission) => submission.phase === phase)
  .sort((left, right) => Number(right.version) - Number(left.version))[0] || null;

const getBatchKey = (value) => {
  const normalized = String(value || '').trim().replace(/^batch\s*/i, '');
  const range = normalized.match(/^(20\d{2})\s*[-–]\s*(20\d{2})$/);
  return range ? range[2] : normalized.toLowerCase();
};

const getStatusLabel = (status) => ({
  draft: 'Draft saved',
  submitted: 'Awaiting faculty review',
  resubmitted: 'Resubmitted, awaiting faculty review',
  approved: 'Faculty signed off',
  changes_requested: 'Changes requested',
}[status] || 'Not submitted');

const isHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
};

const phaseTitlePatterns = {
  abstract: /abstract|proposal|initial/i,
  midterm: /midterm|architecture|design/i,
  final: /final|demonstration|demo/i,
};

export default function ProjectStageSubmissions({ project, deadlines = [], isLeader, onChanged }) {
  const [selectedFiles, setSelectedFiles] = useState({});
  const [uploadingFile, setUploadingFile] = useState('');
  const [uploadProgress, setUploadProgress] = useState({});
  const [successfulUploads, setSuccessfulUploads] = useState({});
  const [submittedStages, setSubmittedStages] = useState({});
  const [savingPhase, setSavingPhase] = useState('');
  const [submittingPhase, setSubmittingPhase] = useState('');
  const [deploymentUrls, setDeploymentUrls] = useState({});
  const [actionErrors, setActionErrors] = useState({});
  const [success, setSuccess] = useState('');

  const legacyFinalStatus = ['submitted', 'under_review', 'resubmitted', 'evaluated'].includes(project.status)
    && project.files?.reportUrl && project.files?.pptUrl && project.files?.codeZipUrl
    ? project.status
    : undefined;

  const handleFileSelection = (event, phase, purpose) => {
    const file = event.target.files?.[0];
    const key = `${phase}:${purpose}`;
    setSelectedFiles((current) => ({ ...current, [key]: file || null }));
    event.target.value = '';
  };

  const handleUpload = async (phase, purpose) => {
    const key = `${phase}:${purpose}`;
    const file = selectedFiles[key];
    if (!file) return;
    setActionErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSuccess('');
    setUploadingFile(key);
    setUploadProgress((current) => ({ ...current, [key]: 0 }));
    try {
      const response = await uploadStageDocument(project._id, phase, purpose, file, (percent) => {
        setUploadProgress((current) => ({ ...current, [key]: percent }));
      });
      const confirmedUpload = getConfirmedStageUpload(response);
      if (!confirmedUpload) throw new Error('The server did not confirm that this file was saved. Please try uploading again.');
      const phaseKey = `${project._id}:${phase}`;
      setSuccessfulUploads((current) => ({
        ...current,
        [phaseKey]: { ...(current[phaseKey] || {}), [purpose]: confirmedUpload },
      }));
      setSelectedFiles((current) => ({ ...current, [key]: null }));
      setSuccess(`${phase.toUpperCase()} ${purpose} uploaded and saved as a draft.`);
      try {
        await onChanged?.();
      } catch {
        setActionErrors((current) => ({
          ...current,
          [key]: 'The upload is saved, but project details could not refresh. Refresh the page to update them.',
        }));
      }
    } catch (uploadError) {
      setActionErrors((current) => ({
        ...current,
        [key]: uploadError.response?.data?.message || `Unable to upload the ${phase} ${purpose}. Check the file and try again.`,
      }));
    } finally {
      setUploadingFile('');
      setUploadProgress((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const handleSaveDraft = async (phase, deploymentUrl) => {
    if (uploadingFile) return;
    setActionErrors((current) => {
      const next = { ...current };
      delete next[`${phase}:draft`];
      return next;
    });
    setSuccess('');
    setSavingPhase(phase);
    try {
      await saveStageDraft(project._id, phase, deploymentUrl);
      await onChanged?.();
      setSuccess(`${phase.toUpperCase()} draft saved.`);
    } catch (saveError) {
      setActionErrors((current) => ({
        ...current,
        [`${phase}:draft`]: saveError.response?.data?.message || `Unable to save the ${phase} draft. Try again.`,
      }));
    } finally {
      setSavingPhase('');
    }
  };

  const handleSubmit = async (phase, deploymentUrl) => {
    if (uploadingFile) return;
    setActionErrors((current) => {
      const next = { ...current };
      delete next[`${phase}:submit`];
      delete next[`${phase}:refresh`];
      return next;
    });
    setSuccess('');
    setSubmittingPhase(phase);
    try {
      const result = await submitStageDocument(project._id, phase, deploymentUrl);
      if (result?.status !== 'success' || !result.submission) {
        throw new Error('The server did not confirm this review submission. Please check the stage status before trying again.');
      }
      setSubmittedStages((current) => ({ ...current, [phase]: result.submission }));
      setSuccess(`${phase.toUpperCase()} review submitted to faculty.`);
      try {
        await onChanged?.();
        setActionErrors((current) => {
          const next = { ...current };
          delete next[`${phase}:refresh`];
          return next;
        });
      } catch {
        setActionErrors((current) => ({
          ...current,
          [`${phase}:refresh`]: 'Your review was submitted successfully, but the project view could not refresh. Refresh the page to update its status.',
        }));
      }
    } catch (submitError) {
      setActionErrors((current) => ({
        ...current,
        [`${phase}:submit`]: submitError.response?.data?.message || submitError.message || `Unable to submit Review ${phase}. Check the requirements and try again.`,
      }));
    } finally {
      setSubmittingPhase('');
    }
  };

  return (
    <section className="space-y-4 border-b border-slate-200 pb-5 dark:border-slate-800" aria-labelledby="stage-submissions-heading">
      <div>
        <h3 id="stage-submissions-heading" className="text-base font-bold">Formal Project Reviews</h3>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">Each review keeps its submitted files, marks, feedback, and sign-off by version.</p>
      </div>
      {success && <p role="status" className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs text-emerald-300">{success}</p>}
      {PHASES.map(({ phase, label, description }, phaseIndex) => {
        const phaseHistory = [...(project.stageSubmissions || [])];
        const localSubmitted = submittedStages[phase];
        if (localSubmitted && !phaseHistory.some((submission) => (
          submission.phase === phase && Number(submission.version) === Number(localSubmitted.version)
        ))) phaseHistory.push(localSubmitted);
        const serverLatest = getLatestSubmission(phaseHistory, phase);
        const projectBatchValues = [project.batch, project.deadline?.batch, project.cohortId]
          .filter(Boolean)
          .map((value) => String(value).trim());
        const projectBatch = projectBatchValues[0] || '';
        const matchesProjectBatch = (item) => !projectBatchValues.length
          || projectBatchValues.some((value) => getBatchKey(item.batch) === getBatchKey(value));
        const history = phaseHistory
          .filter((submission) => submission.phase === phase)
          .sort((left, right) => Number(right.version) - Number(left.version));
        const deadline = deadlines.find((item) => (item.phase || 'final') === phase && matchesProjectBatch(item));
        const misconfiguredDeadline = !deadline && deadlines.find((item) => (
          item.isActive
          && matchesProjectBatch(item)
          && (item.phase || 'final') !== phase
          && phaseTitlePatterns[phase].test(item.title || '')
        ));
        const now = Date.now();
        const deadlineOpen = Boolean(deadline?.isActive
          && now >= new Date(deadline.submissionStartDate).getTime()
          && now <= new Date(deadline.submissionEndDate).getTime());
        const deadlineStart = deadline ? new Date(deadline.submissionStartDate) : null;
        const deadlineEnd = deadline ? new Date(deadline.submissionEndDate) : null;
        const revisionSource = serverLatest?.resubmissionOfVersion
          ? project.stageSubmissions?.find((submission) => (
            submission.phase === phase && Number(submission.version) === Number(serverLatest.resubmissionOfVersion)
          ))
          : serverLatest;
        const revisionGranted = revisionSource?.status === 'changes_requested' && revisionSource.revisionAccessGranted;
        const authorizedRevisionFiles = revisionSource?.revisionFileTypes;
        const phaseUploads = successfulUploads[`${project._id}:${phase}`] || {};
        const revisionDeadlineOpen = Boolean(revisionSource?.revisionAccessGranted
          && revisionSource.revisionDueDate
          && now <= new Date(revisionSource.revisionDueDate).getTime());
        const deadlineStatus = revisionDeadlineOpen && deadline && !deadlineOpen
          ? `Original window closed; revision access is open until ${new Date(revisionSource.revisionDueDate).toLocaleString()}.`
          : !deadline
            ? misconfiguredDeadline
              ? `The existing "${misconfiguredDeadline.title}" window is configured as ${misconfiguredDeadline.phase || 'final'}, not ${phase}. Ask an administrator to correct its phase.`
              : `No active ${phase} deadline is configured for ${projectBatch || 'this project cohort'}. Contact an administrator to configure it.`
            : !deadline.isActive
              ? 'This deadline is inactive. Ask an administrator to review the configured window.'
              : now < deadlineStart.getTime()
                ? `Not yet open. Opens ${deadlineStart.toLocaleString()}.`
                : now > deadlineEnd.getTime()
                  ? `Closed ${deadlineEnd.toLocaleString()}.`
                  : `Open until ${deadlineEnd.toLocaleString()}.`;
        const prerequisiteMet = phaseIndex === 0
          || getLatestSubmission(project.stageSubmissions, PHASES[phaseIndex - 1].phase)?.status === 'approved';
        const revisionWaitingForGrant = serverLatest?.status === 'changes_requested' && !serverLatest.revisionAccessGranted;
        const editableStatus = serverLatest?.status === undefined
          || serverLatest.status === 'draft'
          || (serverLatest.status === 'changes_requested' && revisionSource?.revisionAccessGranted);
        const { canUpload, blockedReasons } = getStageUploadGate({
          isLeader,
          proposalApproved: project.status === 'faculty_accepted',
          deadlineAvailable: Boolean(deadline),
          deadlineOpen,
          revisionDeadlineOpen,
          prerequisiteMet,
          editableStatus,
          revisionWaitingForGrant,
          revisionFeedback: serverLatest?.feedback,
          phase,
          projectBatch,
          misconfiguredDeadline,
        });
        const requiredFiles = FILES.filter((file) => file.phases.includes(phase));
        const { submission: latest, filesReady, canSubmit } = getStageSubmissionEligibility({
          latest: serverLatest,
          uploads: phaseUploads,
          requiredPurposes: requiredFiles.map((file) => file.purpose),
          canUpload,
          phase,
          deploymentUrlValid: isHttpUrl(deploymentUrls[phase] ?? serverLatest?.deploymentUrl ?? ''),
        });
        const deploymentUrl = deploymentUrls[phase] ?? latest?.deploymentUrl ?? '';
        const deploymentUrlValid = isHttpUrl(deploymentUrl);
        const deploymentUrlEditable = canEditStageControl(
          canUpload,
          isStageRevisionItemAuthorized(revisionGranted, authorizedRevisionFiles, 'deploymentUrl'),
        );
        const canSaveDraft = Boolean(canUpload && latest?.status === 'draft'
          && (phase !== 'final' || !deploymentUrl || deploymentUrlValid));
        const visibleFiles = history.length === 0 && phase === 'final' && legacyFinalStatus ? project.files : null;
        const maximumMarks = PHASE_CRITERIA[phase].reduce((total, criterion) => total + criterion.maxMarks, 0);
        return (
          <article key={phase} className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">{label}</h4>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p>
              </div>
              <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase text-[var(--text-secondary)]">
                {getStatusLabel(latest?.status || (phase === 'final' ? legacyFinalStatus : undefined))}{latest?.version ? ` · V${latest.version}` : ''}
              </span>
            </div>

            <p className={`mt-2 text-xs ${deadlineOpen || revisionDeadlineOpen ? 'text-[var(--text-secondary)]' : 'text-amber-300'}`}>{deadlineStatus}</p>
            {blockedReasons.filter((reason) => !/deadline|submission window/i.test(reason)).map((reason) => (
              <p key={reason} className="mt-2 text-xs text-amber-300">{reason}</p>
            ))}
            {latest?.revisionAccessGranted && latest.revisionDueDate && <p className="mt-2 text-xs text-[var(--text-secondary)]">Revision access granted until {new Date(latest.revisionDueDate).toLocaleString()}.</p>}

            {visibleFiles && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              {FILES.filter((file) => visibleFiles[FILE_FIELDS[file.purpose].url]).map((file) => (
                <AuthenticatedFileDownload
                  key={file.purpose}
                  projectId={project._id}
                  purpose={file.purpose}
                  phase={latest?.version ? phase : undefined}
                  versionNumber={latest?.version}
                  filename={visibleFiles[FILE_FIELDS[file.purpose].name] || `${phase}-${file.purpose}`}
                  className="font-semibold text-blue-400 hover:text-blue-300"
                >
                  {file.label}{latest?.version ? ` · V${latest.version}` : ''}
                </AuthenticatedFileDownload>
              ))}
            </div>}
            {latest?.reportOriginality && <ReportOriginalityPanel analysis={latest.reportOriginality} />}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {requiredFiles.map((file) => {
                const fields = FILE_FIELDS[file.purpose];
                const uploaded = Boolean(latest?.files?.[fields.url]);
                const uploadKey = `${phase}:${file.purpose}`;
                const selectedFile = selectedFiles[uploadKey];
                const fileAuthorized = isStageRevisionItemAuthorized(revisionGranted, authorizedRevisionFiles, file.purpose);
                const fileEditable = canEditStageControl(canUpload, fileAuthorized);
                return (
                  <div key={file.purpose} className="flex min-w-56 flex-wrap items-center gap-2">
                    <label
                      className={`rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold ${fileEditable ? 'cursor-pointer hover:bg-slate-800' : 'cursor-not-allowed opacity-50'}`}
                      aria-disabled={!fileEditable}
                      title={!fileEditable ? blockedReasons[0] || 'This review stage is locked.' : undefined}
                    >
                      {uploaded ? `Choose replacement ${file.label}` : `Choose ${file.label}`}
                      <input type="file" accept={file.accept} disabled={!fileEditable || Boolean(uploadingFile || savingPhase || submittingPhase)} onChange={(event) => handleFileSelection(event, phase, file.purpose)} className="sr-only" />
                    </label>
                    {(selectedFile?.name || (uploaded ? latest?.files?.[fields.name] : '')) && (
                      <span className="max-w-48 truncate text-xs text-[var(--text-secondary)]" title={selectedFile?.name || latest?.files?.[fields.name]}>
                        {selectedFile?.name || latest?.files?.[fields.name]}
                      </span>
                    )}
                    <span className="text-xs text-[var(--text-secondary)]" aria-live="polite">
                      {uploadingFile === uploadKey ? `Uploading ${uploadProgress[uploadKey] || 0}%`
                        : uploaded ? 'Uploaded'
                          : selectedFile ? 'Ready to upload' : 'Not uploaded'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpload(phase, file.purpose)}
                      disabled={!selectedFile || !fileEditable || Boolean(uploadingFile || savingPhase || submittingPhase)}
                      className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {uploadingFile === uploadKey ? 'Uploading...' : 'Upload'}
                    </button>
                    {actionErrors[uploadKey] && <p role="alert" className="w-full text-xs text-red-300">{actionErrors[uploadKey]}</p>}
                  </div>
                );
              })}
              {phase === 'final' && (
                <label className="min-w-64 flex-1 text-xs font-semibold">
                  Deployed project URL
                  <input
                    type="url"
                    value={deploymentUrl}
                    disabled={!deploymentUrlEditable || Boolean(uploadingFile || submittingPhase || savingPhase)}
                    onChange={(event) => setDeploymentUrls((current) => ({ ...current, [phase]: event.target.value }))}
                    placeholder="https://your-project.example"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm font-normal"
                  />
                </label>
              )}
              {canSaveDraft && <button
                type="button"
                onClick={() => handleSaveDraft(phase, phase === 'final' && deploymentUrlEditable ? deploymentUrl : undefined)}
                disabled={Boolean(uploadingFile || savingPhase || submittingPhase)}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {savingPhase === phase ? 'Saving...' : 'Save Draft'}
              </button>}
              <button
                type="button"
                onClick={() => handleSubmit(phase, deploymentUrl)}
                disabled={!canSubmit || Boolean(uploadingFile || submittingPhase || savingPhase)}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submittingPhase === phase ? 'Submitting...' : latest?.resubmissionOfVersion ? 'Resubmit to Faculty' : 'Submit to Faculty'}
              </button>
            </div>
            {actionErrors[`${phase}:draft`] && <p role="alert" className="mt-2 text-xs text-red-300">{actionErrors[`${phase}:draft`]}</p>}
            {actionErrors[`${phase}:submit`] && <p role="alert" className="mt-2 text-xs text-red-300">{actionErrors[`${phase}:submit`]}</p>}
            {actionErrors[`${phase}:refresh`] && <p role="alert" className="mt-2 text-xs text-amber-300">{actionErrors[`${phase}:refresh`]}</p>}
            {canUpload && !filesReady && <p className="mt-2 text-xs text-[var(--text-secondary)]">
              Upload all required files successfully to enable submission. Selecting a file is not enough.
            </p>}
            {canUpload && phase === 'final' && filesReady && !deploymentUrlValid && <p className="mt-2 text-xs text-amber-300">Enter a valid HTTP or HTTPS deployment URL before submitting Review 3.</p>}

            {history.map((version) => {
              const review = version.rubricEvaluation?.isPublished ? version.rubricEvaluation : null;
              const reviewMaximum = review?.scores?.reduce((total, score) => total + Number(score.maxMarks || 0), 0) || maximumMarks;
              return (
                <div key={version.version} className="mt-3 rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>Version {version.version} · {getStatusLabel(version.status)}</strong>
                    <span>{version.reviewedAt ? `Reviewed ${new Date(version.reviewedAt).toLocaleString()}` : 'Not signed off'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {FILES.filter((file) => version.files?.[FILE_FIELDS[file.purpose].url]).map((file) => (
                      <AuthenticatedFileDownload
                        key={file.purpose}
                        projectId={project._id}
                        purpose={file.purpose}
                        phase={phase}
                        versionNumber={version.version}
                        filename={version.files[FILE_FIELDS[file.purpose].name] || `${phase}-${file.purpose}`}
                        className="font-semibold text-blue-400 hover:text-blue-300"
                      >
                        Download {file.label}
                      </AuthenticatedFileDownload>
                    ))}
                  </div>
                  <p className="mt-1">Marks: {review ? `${review.totalScore} / ${reviewMaximum}` : 'Not evaluated'}</p>
                  {review?.feedback && <p className="mt-1 text-[var(--text-secondary)]">Evaluation feedback: {review.feedback}</p>}
                  {version.feedback && <p className="mt-1 text-[var(--text-secondary)]">Faculty review: {version.feedback}</p>}
                  {version.deploymentUrl && <a className="mt-1 inline-block text-blue-400 hover:text-blue-300" href={version.deploymentUrl} target="_blank" rel="noreferrer">Open deployed project</a>}
                </div>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}