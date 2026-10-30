const FILE_FIELDS = {
  report: { url: 'reportUrl', name: 'reportName' },
  presentation: { url: 'pptUrl', name: 'pptName' },
  source: { url: 'codeZipUrl', name: 'codeZipName' },
};

export const getConfirmedStageUpload = (response) => {
  const version = Number(response?.version);
  if (response?.status !== 'success' || !response.url || !Number.isInteger(version) || version < 1) return null;
  return { version, url: response.url, name: response.originalName || '' };
};

export const mergeConfirmedStageUploads = (latest, uploads = {}) => {
  let submission = latest ? { ...latest, files: { ...(latest.files || {}) } } : null;

  Object.entries(uploads).forEach(([purpose, upload]) => {
    const fields = FILE_FIELDS[purpose];
    if (!fields || !upload?.url || !Number.isInteger(Number(upload.version))) return;
    const version = Number(upload.version);
    const currentVersion = Number(submission?.version || 0);
    if (version < currentVersion || (version === currentVersion && submission?.status !== 'draft')) return;
    if (!submission || version > currentVersion) {
      submission = { phase: latest?.phase, version, status: 'draft', files: {} };
    }
    submission.files[fields.url] = upload.url;
    if (upload.name) submission.files[fields.name] = upload.name;
  });

  return submission;
};

export const getStageSubmissionEligibility = ({ latest, uploads, requiredPurposes, canUpload, phase, deploymentUrlValid }) => {
  const submission = mergeConfirmedStageUploads(latest, uploads);
  const filesReady = requiredPurposes.every((purpose) => Boolean(submission?.files?.[FILE_FIELDS[purpose]?.url]));
  const canSubmit = Boolean(canUpload
    && submission?.status === 'draft'
    && filesReady
    && (phase !== 'final' || deploymentUrlValid));
  return { submission, filesReady, canSubmit };
};

export const isStageRevisionItemAuthorized = (revisionGranted, authorizedItems, item) => (
  !revisionGranted || (Array.isArray(authorizedItems) && authorizedItems.includes(item))
);

export const canEditStageControl = (canUpload, itemAuthorized = true) => Boolean(canUpload && itemAuthorized);

export const getStageUploadGate = ({
  isLeader,
  proposalApproved,
  deadlineAvailable,
  deadlineOpen,
  revisionDeadlineOpen,
  prerequisiteMet,
  editableStatus,
  revisionWaitingForGrant,
  revisionFeedback,
  phase,
  projectBatch,
  misconfiguredDeadline,
}) => {
  const canUpload = Boolean(isLeader
    && proposalApproved
    && deadlineAvailable
    && (deadlineOpen || revisionDeadlineOpen)
    && prerequisiteMet
    && editableStatus);
  const blockedReasons = [];

  if (!isLeader) blockedReasons.push('Only the project leader can upload and submit review documents.');
  if (!prerequisiteMet) blockedReasons.push(`Locked — complete and obtain faculty approval for Review ${phase === 'final' ? 2 : 1} first.`);
  if (!proposalApproved) blockedReasons.push('Proposal approval is required before review documents can be uploaded.');
  if (revisionWaitingForGrant) {
    blockedReasons.push(`Faculty requested changes: ${revisionFeedback || 'review the faculty feedback above'}. Upload is locked until revision access is granted.`);
  }
  if (!deadlineAvailable) {
    blockedReasons.push(misconfiguredDeadline
      ? `The "${misconfiguredDeadline.title}" deadline is configured as ${misconfiguredDeadline.phase || 'final'}, not ${phase}. Ask an administrator to correct its phase; no new deadline is needed.`
      : `No active ${phase} deadline is configured for ${projectBatch || 'this project cohort'}. Contact an administrator to configure it.`);
  } else if (!deadlineOpen && !revisionDeadlineOpen) {
    blockedReasons.push(`The ${phase} submission window is closed or has not opened. Contact an administrator if the schedule is incorrect.`);
  }
  if (!editableStatus && !revisionWaitingForGrant) {
    blockedReasons.push('This review version is already submitted. Wait for faculty review or use the granted revision access.');
  }

  return { canUpload, blockedReasons };
};