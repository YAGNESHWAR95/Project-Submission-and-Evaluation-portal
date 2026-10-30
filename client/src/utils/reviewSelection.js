const REVIEW_PHASES = new Set(['abstract', 'midterm', 'final']);

export const isValidReviewSubmission = (submission) => {
  const version = Number(submission?.version);
  return Boolean(submission
    && REVIEW_PHASES.has(submission.phase)
    && Number.isInteger(version)
    && version >= 0
    && typeof submission.status === 'string');
};

export const getReviewModalState = ({ isOpen, project, submission, proposalOnly = false, accessRequestOnly = false }) => {
  if (!isOpen) return 'closed';
  if (!project) return 'project-unavailable';
  if (!proposalOnly && !accessRequestOnly && !isValidReviewSubmission(submission)) return 'submission-unavailable';
  return 'ready';
};

const FILE_FIELDS = {
  report: ['reportUrl', 'reportName'],
  presentation: ['pptUrl', 'pptName'],
  source: ['codeZipUrl', 'codeZipName'],
};

export const getSelectedVersionFileReference = (projectId, submission, purpose) => {
  const fields = FILE_FIELDS[purpose];
  if (!projectId || !submission || !fields) return null;
  const [urlField, nameField] = fields;
  if (!submission.files?.[urlField]) return null;

  const version = Number(submission.version);
  const hasStageVersion = Number.isInteger(version) && version > 0;
  return {
    projectId,
    purpose,
    phase: hasStageVersion ? submission.phase : undefined,
    versionNumber: hasStageVersion ? version : undefined,
    filename: submission.files[nameField] || `${purpose}-document`,
  };
};