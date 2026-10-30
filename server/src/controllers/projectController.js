const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const ProjectMember = require('../models/ProjectMember');
const TeamInvitation = require('../models/TeamInvitation');
const Deadline = require('../models/Deadline');
const Notification = require('../models/Notification');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { sendEmailAlert } = require('../services/notificationService');
const { runPlagiarismCheck } = require('../services/plagiarismService');
const { getFacultyRecommendationsForProject } = require('../services/facultyRecommendationService');
const { computeSemanticSimilarity, buildTextSimilarityExplanation } = require('../services/semanticSimilarityService');
const { sendFacultyAssignmentEmail } = require('../services/emailService');
const { getCohortId } = require('../utils/cohort');
const { validateUploadContent } = require('../services/uploadValidationService');
const ProjectMessage = require('../models/ProjectMessage');
const {
  algorithm,
  thresholds,
  results,
  comparisonFields,
} = require('../config/uniquenessConfig');

const ASSIGNMENT_READY_STATUSES = new Set(['uniqueness_checked', 'submitted']);
const ACTIVE_ASSIGNMENT_STATUSES = new Set([
  'faculty_review',
  'faculty_accepted',
  'faculty_changes_requested',
  'under_review',
  'revision_required',
  'resubmitted',
]);
const FORMAL_SUBMISSION_STATUSES = new Set(['faculty_accepted']);
const STAGE_PHASES = new Set(['abstract', 'midterm', 'final']);
const STAGE_FILE_FIELDS = {
  report: { url: 'reportUrl', hash: 'reportHash', name: 'reportName', storage: 'reportStorageName' },
  presentation: { url: 'pptUrl', hash: 'pptHash', name: 'pptName', storage: 'pptStorageName' },
  source: { url: 'codeZipUrl', hash: 'codeZipHash', name: 'codeZipName', storage: 'codeZipStorageName' },
};
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
const MAX_REPORT_COMPARISON_CHARS = 30000;
const MAX_REPORT_COMPARISON_CANDIDATES = 100;

const safeUnlink = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Leave an orphaned file rather than masking the request's primary result.
  }
};

const getStoredUploadPath = (storageName, fileUrl) => {
  let filename = storageName;
  if (!filename && fileUrl) {
    try {
      const pathname = new URL(fileUrl, 'http://local').pathname;
      if (!pathname.includes('/uploads/')) return null;
      filename = path.basename(pathname);
    } catch {
      return null;
    }
  }
  if (!filename || path.basename(filename) !== filename) return null;
  const resolvedPath = path.resolve(UPLOAD_DIR, filename);
  return resolvedPath.startsWith(`${UPLOAD_DIR}${path.sep}`) ? resolvedPath : null;
};

const getProjectFilesSnapshot = (files) => {
  const snapshot = files?.toObject ? files.toObject() : { ...(files || {}) };
  delete snapshot.reportText;
  return snapshot;
};

const serializeProjectWithoutReportText = (project) => {
  const serialized = project?.toObject ? project.toObject() : { ...project };
  if (serialized.files) {
    const files = serialized.files?.toObject ? serialized.files.toObject() : { ...serialized.files };
    delete files.reportText;
    serialized.files = files;
  }
  if (Array.isArray(serialized.stageSubmissions)) {
    serialized.stageSubmissions = serialized.stageSubmissions.map((submission) => {
      const value = submission?.toObject ? submission.toObject() : { ...submission };
      if (value.rubricEvaluation && !value.rubricEvaluation.isPublished) {
        delete value.rubricEvaluation;
      }
      if (value.files) {
        const files = value.files?.toObject ? value.files.toObject() : { ...value.files };
        delete files.reportText;
        value.files = files;
      }
      return value;
    });
  }
  const savedCheck = serialized.uniquenessCheck;
  if (savedCheck && Array.isArray(savedCheck.matches)) {
    const selfId = String(serialized._id || '');
    const filteredMatches = savedCheck.matches.filter((match) => (
      String(match?.projectId?._id || match?.projectId || '') !== selfId
    ));
    if (filteredMatches.length !== savedCheck.matches.length) {
      const overallScore = filteredMatches.reduce((highest, match) => (
        Math.max(highest, Number(match.similarityScore) || 0)
      ), 0);
      serialized.uniquenessCheck = {
        ...savedCheck,
        matches: filteredMatches,
        overallScore,
        result: determineSimilarityResult(overallScore),
        scoreMethod: `${savedCheck.scoreMethod || 'Similarity score'} Legacy self-match removed; score recalculated from remaining comparison projects.`,
      };
    }
  }
  return serialized;
};

const findPhaseDeadline = async (project, phase) => {
  const batchValues = getBatchLookupValues([project.batch, project.deadline?.batch, project.cohortId]);
  if (!batchValues.length) throw new AppError('Project cohort batch is not configured for phase deadlines', 400);
  const phaseFilter = phase === 'final'
    ? { $or: [{ phase: 'final' }, { phase: { $exists: false } }] }
    : { phase };
  const deadline = await Deadline.findOne({ batch: { $in: batchValues }, isActive: true, ...phaseFilter });
  if (!deadline) throw new AppError(`No active ${phase} submission deadline is configured for this cohort`, 404);
  return deadline;
};

const validateProjectDeadline = async (project, { revision = false, now = new Date(), phase, revisionDueDate } = {}) => {
  const deadline = phase ? await findPhaseDeadline(project, phase) : await Deadline.findById(project.deadline);
  if (!deadline) throw new AppError('Project deadline not found', 404);
  if (!deadline.isActive) throw new AppError('Deadline is no longer active', 400);
  const deadlineBatchValues = getBatchLookupValues(deadline.batch);
  const projectBatchValues = getBatchLookupValues([project.batch, project.deadline?.batch, project.cohortId]);
  if (deadlineBatchValues.length && projectBatchValues.length
    && !deadlineBatchValues.some((value) => projectBatchValues.includes(value))) {
    throw new AppError('Project deadline does not match the project cohort batch', 400);
  }

  const start = new Date(deadline.submissionStartDate);
  const end = new Date(deadline.submissionEndDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError('Project deadline dates are invalid', 400);
  }
  if (now < start) throw new AppError('Submission window has not opened yet', 400);

  if (revision) {
    const configuredRevisionDueDate = revisionDueDate || project.revisionRequest?.dueDate;
    const revisionDeadline = configuredRevisionDueDate
      ? new Date(configuredRevisionDueDate)
      : null;
    const hasValidRevisionDueDate = revisionDeadline && !Number.isNaN(revisionDeadline.getTime());
    if (hasValidRevisionDueDate && now > revisionDeadline) {
      throw new AppError('The approved revision deadline has passed', 400);
    }
    if (now > end && !(hasValidRevisionDueDate && revisionDeadline > end)) {
      throw new AppError('The original submission deadline has passed. A faculty/admin revision extension is required.', 400);
    }
  } else if (now > end) {
    throw new AppError('Submission deadline has passed', 400);
  }
};

const getLatestStageSubmission = (project, phase) => (project.stageSubmissions || [])
  .filter((submission) => submission.phase === phase)
  .sort((left, right) => Number(right.version) - Number(left.version))[0] || null;

const getBatchLookupValues = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => getBatchLookupValues(item)))];
  }
  const batch = String(value || '').trim();
  if (!batch) return [];
  const range = batch.match(/^(?:batch\s*)?(20\d{2})\s*[-–]\s*(20\d{2})$/i);
  if (range) return [...new Set([batch, range[2], `Batch ${range[2]}`])];
  const year = batch.match(/^(?:batch\s*)?(20\d{2})$/i);
  if (year) return [...new Set([batch, year[1], `Batch ${year[1]}`])];
  return [batch];
};

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

const hasRequiredStageFiles = (submission, phase, requireDeploymentUrl = true) => {
  if (!submission?.files?.reportUrl || !submission.files.pptUrl) return false;
  return phase !== 'final' || Boolean(submission.files.codeZipUrl
    && (!requireDeploymentUrl || isValidHttpUrl(submission.deploymentUrl)));
};

const isAssignedReviewer = (project, user) => user.role === 'admin'
  || String(project.assignedFaculty?._id || project.assignedFaculty || '') === String(user.id || user._id);

const isAssignmentEligible = (project) => (
  ASSIGNMENT_READY_STATUSES.has(project.status)
  || (project.assignedFaculty && ACTIVE_ASSIGNMENT_STATUSES.has(project.status))
);

const populateAssignedProject = async (projectId) => {
  const query = Project.findById(projectId);
  return query
    .populate('leader', 'name email rollNumber department')
    .populate('teamMembers', 'name email rollNumber department')
    .populate('assignedFaculty', 'name email facultyId department availability facultyProfile')
    .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive');
};

const normalizeNotificationRecipient = (recipient) => {
  const rawId = recipient?._id || recipient;
  if (rawId === undefined || rawId === null || rawId === '') return null;
  const normalizedId = String(rawId);
  return mongoose.isValidObjectId(normalizedId) ? normalizedId : null;
};

const upsertAssignmentNotification = (recipient, project, title, message) => {
  const normalizedRecipient = normalizeNotificationRecipient(recipient);
  if (!normalizedRecipient) return null;

  return Notification.updateOne({
    recipient: normalizedRecipient,
    type: 'faculty_assigned',
    title,
    message,
    relatedProject: project._id,
  }, {
    $setOnInsert: {
      recipient: normalizedRecipient,
      type: 'faculty_assigned',
      title,
      message,
      relatedProject: project._id,
      isRead: false,
    },
  }, { upsert: true });
};

const notifyProjectTeamOfFacultyAssignment = async (project, faculty, previousFacultyId) => {
  const isReassignment = previousFacultyId && String(previousFacultyId) !== String(faculty._id);
  const action = isReassignment ? 'reassigned' : 'assigned';
  const teamMessage = `Project "${project.title}" has been ${action} to faculty ${faculty.name}. Next steps: watch EvalPortal for project review guidance and updates.`;
  const acceptedMemberships = await ProjectMember.find({
    project: project._id,
    invitationStatus: 'accepted',
  }).select('user');
  const teamRecipientIds = new Set([
    project.leader,
    ...(Array.isArray(project.teamMembers) ? project.teamMembers : []),
    ...acceptedMemberships.map((membership) => membership.user),
  ]
    .map((recipient) => normalizeNotificationRecipient(recipient))
    .filter(Boolean));

  const teamNotifications = [...teamRecipientIds].map((recipient) => upsertAssignmentNotification(
    recipient,
    project,
    isReassignment ? 'Faculty Guide Reassigned' : 'Faculty Guide Assigned',
    teamMessage,
  ));
  const facultyMessage = `You have been ${action} as the guide for project "${project.title}".`;
  teamNotifications.push(upsertAssignmentNotification(
    faculty._id,
    project,
    'New Project Assigned',
    facultyMessage,
  ));
  await Promise.all(teamNotifications.filter(Boolean));
};

const normalizeText = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const buildProjectText = (project) => {
  if (!project) return '';
  return comparisonFields
    .map((field) => project[field])
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
};

const getUsableComparisonText = (project) => {
  if (!project) return '';
  const text = buildProjectText(project);
  return normalizeText(text);
};

const createTfIdfVectors = (documents) => {
  const vocab = new Set();
  documents.forEach((doc) => {
    const tokens = normalizeText(doc).split(/\s+/).filter(Boolean);
    tokens.forEach((token) => vocab.add(token));
  });

  const idf = {};
  const docTerms = documents.map((doc) => normalizeText(doc).split(/\s+/).filter(Boolean));

  vocab.forEach((term) => {
    const documentFrequency = docTerms.filter((terms) => terms.includes(term)).length;
    idf[term] = Math.log((documents.length + 1) / (documentFrequency + 1)) + 1;
  });

  const vectors = docTerms.map((terms) => {
    const tfMap = {};
    terms.forEach((term) => {
      tfMap[term] = (tfMap[term] || 0) + 1;
    });

    const vector = {};
    vocab.forEach((term) => {
      const termFrequency = tfMap[term] || 0;
      vector[term] = termFrequency * (idf[term] || 1);
    });

    return vector;
  });

  return { vocab: [...vocab], vectors, idf };
};

const calculateCosineSimilarity = (left, right) => {
  const terms = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  terms.forEach((term) => {
    const leftValue = left[term] || 0;
    const rightValue = right[term] || 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  });

  if (!leftMagnitude || !rightMagnitude) return 0;
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

const SECTION_COMPARISONS = [
  { field: 'title', label: 'Title' },
  { field: 'abstract', label: 'Abstract' },
  { field: 'problemStatement', label: 'Problem statement' },
  { field: 'objectives', label: 'Objectives' },
  { field: 'methodology', label: 'Methodology' },
  { field: 'technologies', label: 'Technologies/tools' },
  { field: 'expectedOutcome', label: 'Expected outcome' },
];

const COMMON_EVIDENCE_TERMS = new Set([
  'about', 'across', 'after', 'also', 'and', 'are', 'based', 'both', 'build', 'but', 'can',
  'develop', 'development', 'different', 'each', 'for', 'from', 'have', 'into', 'its', 'may',
  'more', 'most', 'need', 'other', 'our', 'project', 'projects', 'provide', 'provides', 'such',
  'system', 'systems', 'than', 'that', 'the', 'their', 'these', 'this', 'those', 'through',
  'using', 'used', 'with', 'while', 'will', 'within', 'without', 'who', 'you', 'your',
]);

const getSharedEvidenceTerms = (leftText, rightText) => {
  const leftTerms = new Set(normalizeText(leftText).split(/\s+/).filter((term) => term.length > 2));
  const rightTerms = new Set(normalizeText(rightText).split(/\s+/).filter((term) => term.length > 2));
  return [...leftTerms]
    .filter((term) => rightTerms.has(term) && !COMMON_EVIDENCE_TERMS.has(term))
    .slice(0, 5);
};

const compareProjectSections = (project, candidate) => SECTION_COMPARISONS.map(({ field, label }) => {
  const currentText = typeof project?.[field] === 'string' ? project[field].trim() : '';
  const matchedText = typeof candidate?.[field] === 'string' ? candidate[field].trim() : '';
  const comparable = Boolean(currentText && matchedText);
  const matchingTerms = comparable ? getSharedEvidenceTerms(currentText, matchedText) : [];
  let similarityScore = null;

  if (comparable) {
    const sectionVectors = createTfIdfVectors([normalizeText(currentText), normalizeText(matchedText)]).vectors;
    similarityScore = Number((calculateCosineSimilarity(sectionVectors[0], sectionVectors[1]) * 100).toFixed(2));
  }

  let explanation;
  if (!comparable) {
    explanation = 'Not comparable: text is missing from one or both projects.';
  } else if (field === 'technologies') {
    explanation = matchingTerms.length
      ? `Both projects list ${matchingTerms.join(', ')}. Shared tools alone do not establish copied work.`
      : 'Comparable tool lists are present, but no distinctive shared terms were found.';
  } else if (matchingTerms.length) {
    explanation = `Both sections contain the terms ${matchingTerms.join(', ')}. This is textual overlap, not a plagiarism determination.`;
  } else {
    explanation = 'Comparable text is present, but no distinctive shared terms were found.';
  }

  return {
    field,
    label,
    currentTextAvailable: Boolean(currentText),
    matchedTextAvailable: Boolean(matchedText),
    comparable,
    similarityScore,
    matchingTerms,
    explanation,
  };
});

const getReportPages = (reportText) => String(reportText || '')
  .split('\f')
  .map((text, index) => ({ pageNumber: index + 1, text: text.trim() }))
  .filter((page) => page.text)
  .slice(0, 100);

const buildReportOriginalityResult = async (project) => {
  const reportText = String(project.files?.reportText || '').trim();
  const pages = getReportPages(reportText);
  const pagesAnalyzed = Number(project.files?.reportPagesAnalyzed) || pages.length;
  const reportWords = normalizeText(reportText).split(/\s+/).filter(Boolean).length;
  const reportHash = project.files?.reportHash || '';
  const base = {
    checkedAt: new Date(),
    reportHash,
    analysisVersion: Number(project.files?.reportAnalysisVersion) || 1,
    algorithm: 'TF-IDF cosine on extracted PDF report text',
    semanticStatus: 'not_attempted',
    overallScore: null,
    result: 'insufficient_text',
    matches: [],
  };

  if (project.files?.reportTextStatus === 'needs_ocr' || !reportText) {
    return {
      ...base,
      status: 'needs_ocr',
      scoreMethod: 'No report similarity score is available because the PDF contains no extractable text. OCR is not configured.',
      comparisonCoverage: {
        pagesAvailable: Number(project.files?.reportPageCount) || 0,
        pagesAnalyzed: Number(project.files?.reportPagesAnalyzed) || 0,
        extractedCharacters: 0,
        projectsCompared: 0,
        proposalSourcesCompared: 0,
        priorReportSourcesCompared: 0,
      },
    };
  }
  if (reportWords < 20) {
    return {
      ...base,
      status: 'insufficient_text',
      scoreMethod: 'No report similarity score is available because fewer than 20 readable words were extracted.',
      comparisonCoverage: {
        pagesAvailable: Number(project.files?.reportPageCount) || pages.length,
        pagesAnalyzed,
        extractedCharacters: reportText.length,
        projectsCompared: 0,
        proposalSourcesCompared: 0,
        priorReportSourcesCompared: 0,
      },
    };
  }

  const query = {
    _id: { $ne: project._id },
    status: { $nin: ['withdrawn', 'rejected'] },
    $or: [
      ...comparisonFields.map((field) => ({ [field]: { $exists: true, $ne: '' } })),
      { 'files.reportText': { $exists: true, $ne: '' } },
      { 'stageSubmissions.files.reportText': { $exists: true, $ne: '' } },
    ],
  };
  const candidateResult = await Project.find(query);
  const candidates = Array.isArray(candidateResult)
    ? candidateResult.slice(0, MAX_REPORT_COMPARISON_CANDIDATES)
    : await candidateResult
      .select(`_id title domain status ${comparisonFields.join(' ')} files.reportText files.reportTextStatus stageSubmissions.phase stageSubmissions.version stageSubmissions.status stageSubmissions.files.reportText stageSubmissions.files.reportTextStatus`)
      .limit(MAX_REPORT_COMPARISON_CANDIDATES);

  const sources = [];
  candidates.forEach((candidate) => {
    if (!candidate || String(candidate._id) === String(project._id)) return;
    const proposalText = getUsableComparisonText(candidate);
    if (proposalText.split(/\s+/).filter(Boolean).length >= 10) {
      sources.push({
        projectId: candidate._id,
        title: candidate.title || 'Historical project',
        domain: candidate.domain || '',
        sourceType: 'proposal',
        text: proposalText,
      });
    }
    const previousReport = normalizeText(String(candidate.files?.reportText || '').slice(0, MAX_REPORT_COMPARISON_CHARS));
    if (candidate.files?.reportTextStatus === 'available' && previousReport.split(/\s+/).filter(Boolean).length >= 20) {
      sources.push({
        projectId: candidate._id,
        title: candidate.title || 'Historical project',
        domain: candidate.domain || '',
        sourceType: 'report',
        sourcePhase: 'final',
        sourceVersion: 0,
        text: previousReport,
      });
    }
    (candidate.stageSubmissions || [])
      .filter((submission) => ['submitted', 'resubmitted', 'approved'].includes(submission.status)
        && submission.files?.reportTextStatus === 'available')
      .forEach((submission) => {
        const stageReport = normalizeText(String(submission.files?.reportText || '').slice(0, MAX_REPORT_COMPARISON_CHARS));
        if (stageReport.split(/\s+/).filter(Boolean).length < 20) return;
        sources.push({
          projectId: candidate._id,
          title: candidate.title || 'Historical project',
          domain: candidate.domain || '',
          sourceType: 'report',
          sourcePhase: submission.phase,
          sourceVersion: Number(submission.version) || 0,
          text: stageReport,
        });
      });
  });

  const proposalSourcesCompared = sources.filter((source) => source.sourceType === 'proposal').length;
  const priorReportSourcesCompared = sources.filter((source) => source.sourceType === 'report').length;
  const projectsCompared = new Set(sources.map((source) => String(source.projectId))).size;
  const comparisonCoverage = {
    pagesAvailable: Number(project.files?.reportPageCount) || pages.length,
    pagesAnalyzed,
    pageCoveragePercent: Number((pagesAnalyzed / Math.max(1, Number(project.files?.reportPageCount) || pagesAnalyzed) * 100).toFixed(1)),
    extractedCharacters: reportText.length,
    projectsCompared,
    proposalSourcesCompared,
    priorReportSourcesCompared,
  };
  if (!sources.length) {
    return {
      ...base,
      status: 'no_comparisons',
      scoreMethod: 'No eligible prior proposal or report text was available in this portal; no similarity score was calculated.',
      comparisonCoverage,
    };
  }

  const fullReportText = normalizeText(reportText.slice(0, MAX_REPORT_COMPARISON_CHARS));
  const { vectors } = createTfIdfVectors([fullReportText, ...sources.map((source) => source.text)]);
  const scoredSources = sources.map((source, index) => ({
    ...source,
    textScore: Math.min(1, Math.max(0, calculateCosineSimilarity(vectors[0], vectors[index + 1]))),
  }));
  const bestSource = [...scoredSources].sort((left, right) => right.textScore - left.textScore)[0];
  let semanticComparison = null;
  if (bestSource?.textScore > 0) semanticComparison = computeSemanticSimilarity(fullReportText, bestSource.text);

  const projectMatches = new Map();
  scoredSources.forEach((source) => {
    const key = String(source.projectId);
    const existing = projectMatches.get(key);
    if (!existing || source.textScore > existing.textScore) {
      projectMatches.set(key, { ...source, matchingSections: [] });
    }
  });
  const leadingMatches = [...projectMatches.values()]
    .sort((left, right) => right.textScore - left.textScore)
    .slice(0, 5);
  const matchedSectionsByProject = new Map(leadingMatches.map((match) => [String(match.projectId), []]));
  leadingMatches.forEach((match) => {
    const matchedSource = scoredSources.find((source) => (
      String(source.projectId) === String(match.projectId) && source.sourceType === match.sourceType
    ));
    pages.forEach((page) => {
      const sectionVectors = createTfIdfVectors([normalizeText(page.text), matchedSource.text]).vectors;
      const similarityScore = Number((calculateCosineSimilarity(sectionVectors[0], sectionVectors[1]) * 100).toFixed(2));
      if (similarityScore <= 0) return;
      const matchingTerms = getSharedEvidenceTerms(page.text, matchedSource.text);
      matchedSectionsByProject.get(String(match.projectId)).push({
        reportPage: page.pageNumber,
        matchedSource: match.sourceType,
        matchedPhase: matchedSource.sourcePhase || '',
        matchedVersion: matchedSource.sourceVersion || 0,
        similarityScore,
        matchingTerms,
        explanation: `Extracted report text on page ${page.pageNumber} overlaps with the prior project ${match.sourceType}. This is text overlap, not a plagiarism finding.`,
      });
    });
  });

  const semanticAvailable = semanticComparison?.semanticAvailable === true
    && semanticComparison.score !== null
    && semanticComparison.score !== undefined
    && Number.isFinite(Number(semanticComparison.score));
  const semanticScore = semanticAvailable ? Number((Number(semanticComparison.score) * 100).toFixed(2)) : null;
  const matches = leadingMatches
    .filter((match) => match.textScore > 0)
    .map((match) => {
      const matchingSections = matchedSectionsByProject.get(String(match.projectId)) || [];
      const isSemanticMatch = String(match.projectId) === String(bestSource.projectId)
        && match.sourceType === bestSource.sourceType;
      return {
        projectId: match.projectId,
        title: match.title,
        domain: match.domain,
        matchedSource: match.sourceType,
        sourcePhase: match.sourcePhase || '',
        sourceVersion: match.sourceVersion || 0,
        similarityScore: Number((match.textScore * 100).toFixed(2)),
        textSimilarity: Number((match.textScore * 100).toFixed(2)),
        semanticSimilarity: isSemanticMatch && semanticAvailable ? semanticScore : null,
        semanticStatus: isSemanticMatch
          ? semanticAvailable ? 'available' : semanticComparison ? 'unavailable' : 'not_attempted'
          : 'not_attempted',
        semanticReason: isSemanticMatch ? semanticComparison?.reason || '' : '',
        matchingSections: matchingSections.sort((left, right) => right.similarityScore - left.similarityScore).slice(0, 5),
        evidence: matchingSections.length
          ? `Matched report pages ${[...new Set(matchingSections.map((section) => section.reportPage))].join(', ')} against prior ${match.sourceType} text.`
          : `The overall report text has TF-IDF cosine overlap with prior ${match.sourceType} text.`,
        explanation: 'Similarity measures overlapping text in portal records only; it does not establish plagiarism.',
      };
    });
  const overallScore = matches.length ? Number(matches[0].similarityScore.toFixed(2)) : 0;

  return {
    ...base,
    status: 'completed',
    algorithm: 'TF-IDF + cosine similarity over extracted report text and portal proposal/report sources',
    semanticStatus: semanticAvailable ? 'available' : semanticComparison ? 'unavailable' : 'not_attempted',
    overallScore,
    result: determineSimilarityResult(overallScore),
    scoreMethod: 'The reported score is the highest TF-IDF cosine text-similarity match against eligible portal proposals or previous extracted reports. Any Sentence-BERT value is shown separately and does not alter this score.',
    comparisonCoverage,
    matches,
  };
};

const determineSimilarityResult = (score) => {
  if (score <= thresholds.likelyUniqueMax) return results.likelyUnique;
  if (score <= thresholds.needsAttentionMax) return results.needsAttention;
  return results.highSimilarity;
};

const getSimilarityCheckState = (project) => {
  const check = project?.uniquenessCheck;
  if (!check) return { status: 'not_checked', score: 0 };

  const score = Number(check.overallScore ?? 0);
  const status = check.status || 'not_checked';
  return { status, score };
};

const getSimilarityPercent = (score) => Math.round((score || 0) * 100);

const PROJECT_EDITABLE_FIELDS = [
  'title',
  'abstract',
  'problemStatement',
  'objectives',
  'methodology',
  'technologies',
  'expectedOutcome',
  'description',
  'keywords',
  'domain',
  'proposedSolution',
];

const NORMALIZED_REVISION_FIELD_SET = new Set(PROJECT_EDITABLE_FIELDS);
const REVISION_FILE_TYPES = new Set(['report', 'presentation', 'source']);

const getProjectMemberIds = (project = {}) => {
  const rawMembers = [
    project.leader,
    ...(Array.isArray(project.teamMembers) ? project.teamMembers : []),
  ];

  return [...new Set(rawMembers.filter(Boolean).map((member) => String(member)))];
};

const isAuthorizedProjectParticipant = (project, user) => {
  if (!project || !user) return false;
  if (user.role === 'admin') return true;
  if (project.assignedFaculty && String(project.assignedFaculty) === String(user.id)) return true;
  return getProjectMemberIds(project).includes(String(user.id));
};

const sanitizeEditableFields = (fields = []) => {
  if (!Array.isArray(fields)) return [];
  return [...new Set(fields
    .map((field) => String(field).trim())
    .filter((field) => NORMALIZED_REVISION_FIELD_SET.has(field)))];
};

const getRevisionAllowedFields = (project) => {
  if (!project?.revisionRequest || !project.revisionRequest.active) return [];
  return sanitizeEditableFields(project.revisionRequest.editableFields || []);
};

const getProjectMessageRecipients = (project, senderId) => {
  const recipients = [...new Set([
    ...getProjectMemberIds(project),
    ...(project.assignedFaculty ? [String(project.assignedFaculty)] : []),
  ])];
  return recipients.filter((id) => id !== String(senderId));
};

const sendProjectMessageNotification = async (project, senderId, senderName, senderRole) => {
  const recipients = getProjectMessageRecipients(project, senderId);
  if (!recipients.length) return [];

  const notifications = recipients.map((recipientId) => Notification.create({
    recipient: recipientId,
    type: 'project_message',
    title: 'Project discussion update',
    message: `${senderName} (${senderRole}) sent a new message in "${project.title || 'Project'}".`,
    relatedProject: project._id,
    isRead: false,
  }));

  return Promise.all(notifications);
};

const getProjectMessages = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (!isAuthorizedProjectParticipant(project, req.user)) {
      return next(new AppError('You are not authorized to access this project discussion', 403));
    }

    const messageQuery = await ProjectMessage.find({ project: project._id });
    const messages = Array.isArray(messageQuery)
      ? messageQuery
      : await messageQuery.populate('sender', 'name email role').sort({ createdAt: 1 });

    res.status(200).json({
      status: 'success',
      messages,
    });
  } catch (error) {
    next(error);
  }
};

const createProjectMessage = async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !String(content).trim()) {
      return next(new AppError('Message content is required', 400));
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (!isAuthorizedProjectParticipant(project, req.user)) {
      return next(new AppError('You are not authorized to message in this project discussion', 403));
    }

    const message = await ProjectMessage.create({
      project: project._id,
      sender: req.user.id,
      senderRole: req.user.role,
      content: String(content).trim(),
    });

    const populated = typeof message.populate === 'function'
      ? await message.populate('sender', 'name email role')
      : message;
    await sendProjectMessageNotification(project, req.user.id, req.user.name || 'Project member', req.user.role);

    res.status(201).json({
      status: 'success',
      message: populated,
    });
  } catch (error) {
    next(error);
  }
};

const requestRevision = async (req, res, next) => {
  try {
    const { reason, editableFields, revisionDeadline, feedback, phase = 'project' } = req.body;
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (req.user.role === 'faculty' && (!project.assignedFaculty || String(project.assignedFaculty) !== String(req.user.id))) {
      return next(new AppError('You are not assigned to this project', 403));
    }
    if (req.user.role === 'admin') {
      // admins may initiate a revision when they have project oversight
    } else if (req.user.role !== 'faculty') {
      return next(new AppError('Only the assigned faculty member can request a revision', 403));
    }

    const finalReason = String(reason || feedback || '').trim();
    if (!finalReason) {
      return next(new AppError('A revision reason is required', 400));
    }

    const dueDate = revisionDeadline ? new Date(revisionDeadline) : null;
    if (revisionDeadline && Number.isNaN(dueDate.getTime())) {
      return next(new AppError('Revision deadline must be a valid date', 400));
    }

    const sanitizedFields = sanitizeEditableFields(editableFields);
    const allowedFileTypes = Array.isArray(req.body.fileTypes)
      ? [...new Set(req.body.fileTypes.filter((type) => REVISION_FILE_TYPES.has(type)))]
      : [];
    if (!sanitizedFields.length && !allowedFileTypes.length) {
      return next(new AppError('At least one editable field must be selected for the revision request', 400));
    }

    project.revisionRequest = {
      active: false,
      status: 'pending',
      phase: phase === 'proposal' ? 'proposal' : 'project',
      reason: finalReason,
      feedback: finalReason,
      requestedBy: req.user.id,
      requestedAt: new Date(),
      dueDate,
      editableFields: sanitizedFields,
      fileTypes: allowedFileTypes,
      snapshotBeforeRevision: {
        title: project.title,
        description: project.description,
        abstract: project.abstract,
        problemStatement: project.problemStatement,
        objectives: project.objectives,
        proposedSolution: project.proposedSolution,
        methodology: project.methodology,
        technologies: project.technologies,
        expectedOutcome: project.expectedOutcome,
        domain: project.domain,
        keywords: project.keywords,
        reportOriginality: project.reportOriginality,
        files: getProjectFilesSnapshot(project.files),
      },
    };
    project.status = 'revision_required';
    project.facultyComment = finalReason;
    await project.save();

    const teamRecipients = getProjectMemberIds(project).filter((memberId) => memberId !== String(req.user.id));
    for (const recipientId of teamRecipients) {
      await Notification.create({
        recipient: recipientId,
        type: 'revision_requested',
        title: 'Revision requested',
        message: `A faculty member requested revisions for "${project.title}". Review the feedback and required changes.`,
        relatedProject: project._id,
        isRead: false,
      });
    }

    res.status(200).json({
      status: 'success',
      project,
      revisionRequest: project.revisionRequest,
    });
  } catch (error) {
    next(error);
  }
};

const grantRevisionAccess = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (req.user.role !== 'faculty' && req.user.role !== 'admin') {
      return next(new AppError('Only faculty or admins can grant revision access', 403));
    }

    if (req.user.role === 'faculty' && (!project.assignedFaculty || String(project.assignedFaculty) !== String(req.user.id))) {
      return next(new AppError('You are not assigned to this project', 403));
    }

    if (!project.revisionRequest) {
      return next(new AppError('No revision request exists for this project', 400));
    }
    if (project.revisionRequest.status !== 'pending') {
      return next(new AppError('Revision access can only be granted for a pending revision request', 400));
    }

    const editableFields = sanitizeEditableFields(project.revisionRequest.editableFields);
    const fileTypes = Array.isArray(project.revisionRequest.fileTypes)
      ? [...new Set(project.revisionRequest.fileTypes.filter((type) => REVISION_FILE_TYPES.has(type)))]
      : [];
    if (editableFields.length === 0 && fileTypes.length === 0) {
      return next(new AppError('Revision access cannot be granted without at least one permitted field or file type', 400));
    }
    if (project.revisionRequest.phase !== 'proposal') {
      await validateProjectDeadline(project, { revision: true });
    }
    project.revisionRequest.editableFields = editableFields;
    project.revisionRequest.fileTypes = fileTypes;

    project.revisionRequest.active = true;
    project.revisionRequest.status = 'granted';
    project.revisionRequest.grantedBy = req.user.id;
    project.revisionRequest.grantedAt = new Date();
    project.status = 'revision_required';
    await project.save();

    for (const memberId of getProjectMemberIds(project)) {
      await Notification.create({
        recipient: memberId,
        type: 'revision_requested',
        title: 'Revision access granted',
        message: `Revision access has been granted for "${project.title}". Update only the approved sections.`,
        relatedProject: project._id,
        isRead: false,
      });
    }

    res.status(200).json({
      status: 'success',
      project,
      revisionRequest: project.revisionRequest,
    });
  } catch (error) {
    next(error);
  }
};

const requestRevisionAccess = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    const isProjectMember = (project.teamMembers || []).some((member) => (
      String(member?._id || member) === String(req.user.id)
    ));
    if (req.user.role !== 'student' || !isProjectMember) {
      return next(new AppError('Only project team members can request revision permission', 403));
    }
    const reason = String(req.body.reason || '').trim();
    if (!reason) return next(new AppError('Explain why revision permission is needed', 400));
    if (project.revisionAccessRequest?.status === 'pending') {
      return next(new AppError('A revision permission request is already awaiting faculty review', 409));
    }
    if (project.revisionRequest?.status === 'pending'
      || (project.revisionRequest?.status === 'granted' && project.revisionRequest.active)) {
      return next(new AppError('An active faculty revision request or grant already exists', 409));
    }
    project.revisionAccessRequest = {
      status: 'pending',
      reason,
      requestedBy: req.user.id,
      requestedAt: new Date(),
      editableFields: [],
      fileTypes: [],
    };
    await project.save();
    res.status(201).json({ status: 'success', request: project.revisionAccessRequest });
  } catch (error) {
    next(error);
  }
};

const respondToRevisionAccessRequest = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    if (!isAssignedReviewer(project, req.user)) {
      return next(new AppError('Only the assigned faculty member or an admin can respond to this request', 403));
    }
    const accessRequest = project.revisionAccessRequest;
    if (!accessRequest || accessRequest.status !== 'pending') {
      return next(new AppError('No student revision permission request is awaiting review', 400));
    }
    const { decision, editableFields, fileTypes, revisionDeadline } = req.body;
    if (!['grant', 'deny'].includes(decision)) return next(new AppError('Decision must be grant or deny', 400));
    const proposalPhase = project.stageWorkflowEnabled
      || ['draft', 'proposal_created', 'uniqueness_checked', 'faculty_review', 'faculty_changes_requested'].includes(project.status);
    const parsedFields = sanitizeEditableFields(editableFields);
    const parsedFileTypes = !project.stageWorkflowEnabled && Array.isArray(fileTypes)
      ? [...new Set(fileTypes.filter((fileType) => REVISION_FILE_TYPES.has(fileType)))]
      : [];
    if (decision === 'grant' && parsedFields.length === 0 && parsedFileTypes.length === 0) {
      return next(new AppError('Select at least one field or file type to grant', 400));
    }
    const dueDate = revisionDeadline ? new Date(revisionDeadline) : null;
    if (revisionDeadline && Number.isNaN(dueDate.getTime())) {
      return next(new AppError('Revision deadline must be a valid date', 400));
    }
    if (decision === 'grant') {
      if (!proposalPhase) {
        await validateProjectDeadline(project, { revision: true, revisionDueDate: dueDate });
      }
      const now = new Date();
      project.revisionRequest = {
        active: true,
        phase: proposalPhase ? 'proposal' : 'project',
        status: 'granted',
        reason: accessRequest.reason,
        feedback: accessRequest.reason,
        requestedBy: accessRequest.requestedBy,
        requestedAt: accessRequest.requestedAt,
        grantedBy: req.user.id || req.user._id,
        grantedAt: now,
        dueDate,
        editableFields: parsedFields,
        fileTypes: parsedFileTypes,
        snapshotBeforeRevision: {
          title: project.title,
          description: project.description,
          abstract: project.abstract,
          problemStatement: project.problemStatement,
          objectives: project.objectives,
          proposedSolution: project.proposedSolution,
          methodology: project.methodology,
          technologies: project.technologies,
          expectedOutcome: project.expectedOutcome,
          domain: project.domain,
          keywords: project.keywords,
          files: getProjectFilesSnapshot(project.files),
        },
      };
      accessRequest.status = 'granted';
      accessRequest.editableFields = parsedFields;
      accessRequest.fileTypes = parsedFileTypes;
      accessRequest.revisionDeadline = dueDate;
    } else {
      accessRequest.status = 'denied';
    }
    accessRequest.reviewedBy = req.user.id || req.user._id;
    accessRequest.reviewedAt = new Date();
    await project.save();
    res.status(200).json({ status: 'success', request: accessRequest, revisionRequest: project.revisionRequest });
  } catch (error) {
    next(error);
  }
};

const resubmitProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (project.leader.toString() !== req.user.id) {
      return next(new AppError('Only the project leader can resubmit this project', 403));
    }

    if (!project.revisionRequest || !project.revisionRequest.active || project.revisionRequest.status !== 'granted') {
      return next(new AppError('This project does not currently have an active revision grant', 400));
    }

    const editableFields = sanitizeEditableFields(project.revisionRequest.editableFields);
    const fileTypes = Array.isArray(project.revisionRequest.fileTypes)
      ? project.revisionRequest.fileTypes.filter((type) => REVISION_FILE_TYPES.has(type))
      : [];
    if (editableFields.length === 0 && fileTypes.length === 0) {
      return next(new AppError('This revision grant has no permitted fields or file types. Contact the assigned faculty member.', 400));
    }

    const isProposalRevision = project.revisionRequest.phase === 'proposal';
    if (!isProposalRevision) await validateProjectDeadline(project, { revision: true });
    if (!isProposalRevision && (!project.files?.reportUrl || !project.files?.pptUrl || !project.files?.codeZipUrl)) {
      return next(new AppError('All required project documents must be present before resubmission', 400));
    }

    const versionNumber = Array.isArray(project.revisionHistory) ? project.revisionHistory.length + 1 : 1;
    const snapshot = {
      versionNumber,
      submittedBy: project.leader,
      submittedAt: project.submittedAt || project.revisionRequest.requestedAt || new Date(),
      summary: project.revisionRequest.reason || 'Resubmission after faculty revision request',
      fieldsChanged: project.revisionRequest.editableFields || [],
      snapshot: project.revisionRequest.snapshotBeforeRevision || {
        title: project.title,
        description: project.description,
        abstract: project.abstract,
        problemStatement: project.problemStatement,
        objectives: project.objectives,
        proposedSolution: project.proposedSolution,
        methodology: project.methodology,
        technologies: project.technologies,
        expectedOutcome: project.expectedOutcome,
        domain: project.domain,
        keywords: project.keywords,
        reportOriginality: project.reportOriginality,
        files: getProjectFilesSnapshot(project.files),
      },
      reviewOutcome: 'changes_requested',
    };

    if (!project.reportOriginality || project.reportOriginality.reportHash !== project.files?.reportHash) {
      try {
        project.reportOriginality = await buildReportOriginalityResult(project);
      } catch {
        project.reportOriginality = {
          status: 'failed',
          reportHash: project.files?.reportHash || '',
          checkedAt: new Date(),
          overallScore: null,
          semanticStatus: 'not_attempted',
          algorithm: 'Report analysis did not complete',
          scoreMethod: 'No report similarity score is available because portal comparison failed.',
          comparisonCoverage: { pagesAnalyzed: 0, pagesAvailable: project.files?.reportPageCount || 0, projectsCompared: 0 },
          matches: [],
        };
      }
    }

    project.revisionHistory = Array.isArray(project.revisionHistory) ? [...project.revisionHistory, snapshot] : [snapshot];
    project.revisionRequest.active = false;
    project.revisionRequest.status = 'resolved';
    project.status = isProposalRevision ? 'proposal_created' : 'resubmitted';
    project.submittedAt = isProposalRevision ? undefined : new Date();
    project.facultyComment = project.revisionRequest.reason || project.facultyComment || '';
    if (!isProposalRevision && project.files?.reportUrl && project.files?.pptUrl && project.files?.codeZipUrl) {
      if (!Array.isArray(project.stageSubmissions)) project.stageSubmissions = [];
      const previousFinal = getLatestStageSubmission(project, 'final');
      const finalVersion = Number(previousFinal?.version || 0) + 1;
      const finalFiles = project.files?.toObject ? project.files.toObject() : { ...project.files };
      finalFiles.reportUrl = `/api/projects/${project._id}/files/report/download?stagePhase=final&versionNumber=${finalVersion}`;
      finalFiles.pptUrl = `/api/projects/${project._id}/files/presentation/download?stagePhase=final&versionNumber=${finalVersion}`;
      finalFiles.codeZipUrl = `/api/projects/${project._id}/files/source/download?stagePhase=final&versionNumber=${finalVersion}`;
      project.stageSubmissions.push({
        phase: 'final',
        version: finalVersion,
        resubmissionOfVersion: previousFinal?.version,
        files: finalFiles,
        status: 'resubmitted',
        submittedAt: project.submittedAt,
        reportOriginality: project.reportOriginality,
      });
    }
    await project.save();

    const recipients = [...new Set([
      ...getProjectMemberIds(project),
      ...(project.assignedFaculty ? [String(project.assignedFaculty)] : []),
    ])].filter((memberId) => memberId !== String(req.user.id));
    for (const recipientId of recipients) {
      await Notification.create({
        recipient: recipientId,
        type: 'project_status',
        title: 'Project resubmitted for review',
        message: `Project "${project.title}" was resubmitted after the requested revisions and is ready for faculty review.`,
        relatedProject: project._id,
        isRead: false,
      });
    }

    res.status(200).json({
      status: 'success',
      project,
      revisionHistory: project.revisionHistory,
    });
  } catch (error) {
    next(error);
  }
};

// Request presigned/direct upload URL
const getUploadUrl = async (req, res, next) => {
  try {
    const { projectId, purpose } = req.query;
    if (!projectId || !['report', 'presentation', 'source'].includes(purpose)) {
      return next(new AppError('Project ID and a valid document purpose are required', 400));
    }
    const project = await Project.findById(projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (String(project.leader?._id || project.leader) !== String(req.user.id)) {
      return next(new AppError('Only the project leader can upload files', 403));
    }
    const revisionGrantActive = Boolean(
      project.revisionRequest?.active && project.revisionRequest.status === 'granted'
    );
    const allowedRevisionFiles = project.revisionRequest?.fileTypes || [];
    if (project.status !== 'faculty_accepted' && !(revisionGrantActive && allowedRevisionFiles.includes(purpose))) {
      return next(new AppError('Files can only be uploaded after proposal approval or during an active revision grant for the approved file type.', 400));
    }
    if (revisionGrantActive && project.revisionRequest?.phase !== 'proposal') {
      await validateProjectDeadline(project, { revision: true });
    }

    const serverUrl = (process.env.SERVER_URL || 'http://localhost:5000').replace(/\/+$/, '');
    const uploadData = {
      provider: 'project-api',
      uploadUrl: `${serverUrl}/api/projects/${project._id}/files`,
      method: 'POST',
      fields: { purpose },
      fileKey: 'file',
    };
    res.status(200).json({
      status: 'success',
      data: uploadData,
    });
  } catch (error) {
    next(error);
  }
};

// Create project proposal - Student only
const createProject = async (req, res, next) => {
  try {
    const {
      title,
      domain,
      abstract,
      problemStatement,
      objectives,
      methodology,
      technologies,
      expectedOutcome,
      deadline,
    } = req.body;
    const leaderId = req.user.id;

    // Validate user is a student
    if (req.user.role !== 'student') {
      return next(new AppError('Only students can create projects', 403));
    }

    const cohortId = getCohortId(req.user);
    if (!cohortId) {
      return next(new AppError('Your academic cohort is not configured. Contact an administrator to set your department, section, and batch before creating a project.', 400));
    }

    const proposalFields = {
      title,
      domain,
      abstract,
      problemStatement,
      objectives,
      methodology,
      technologies,
      expectedOutcome,
    };
    const fieldLimits = {
      title: 200,
      domain: 120,
      abstract: 3000,
      problemStatement: 5000,
      objectives: 5000,
      methodology: 5000,
      technologies: 1000,
      expectedOutcome: 5000,
    };

    for (const [field, value] of Object.entries(proposalFields)) {
      if (typeof value !== 'string' || !value.trim()) {
        return next(new AppError(`${field} is required`, 400));
      }
      if (value.trim().length > fieldLimits[field]) {
        return next(new AppError(`${field} cannot exceed ${fieldLimits[field]} characters`, 400));
      }
    }

    // Proposals have no deadline until a submission stage is configured.
    const existingProject = await Project.findOne({
      leader: leaderId,
      status: { $ne: 'withdrawn' },
    });
    if (existingProject) {
      return next(new AppError('You already have a project proposal', 409));
    }

    let projectDeadline = null;
    if (deadline) {
      projectDeadline = await Deadline.findById(deadline);
      if (!projectDeadline) {
        return next(new AppError('Selected proposal deadline was not found', 404));
      }
      if ((projectDeadline.phase || 'final') !== 'final') {
        return next(new AppError('Projects must be associated with a FINAL deadline; phase deadlines are used by stage submissions.', 400));
      }
      if (!projectDeadline.isActive) {
        return next(new AppError('The selected deadline is no longer active', 400));
      }
      const deadlineBatchValues = getBatchLookupValues(projectDeadline.batch);
      const studentBatchValues = getBatchLookupValues(req.user.batch);
      if (deadlineBatchValues.length && studentBatchValues.length
        && !deadlineBatchValues.some((value) => studentBatchValues.includes(value))) {
        return next(new AppError('This deadline does not match your cohort batch', 400));
      }
    }

    const newProject = await Project.create({
      title: title.trim(),
      description: problemStatement.trim(),
      projectType: 'major_project',
      abstract: abstract.trim(),
      problemStatement: problemStatement.trim(),
      objectives: objectives.trim(),
      methodology: methodology.trim(),
      expectedOutcome: expectedOutcome.trim(),
      technologies: technologies.trim(),
      domain: domain.trim(),
      leader: leaderId,
      teamMembers: [leaderId],
      department: req.user.department || '',
      section: req.user.section,
      batch: req.user.batch,
      academicYear: req.user.academicYear,
      cohortId,
      deadline: projectDeadline ? projectDeadline._id : undefined,
      status: 'proposal_created',
      stageWorkflowEnabled: true,
    });

    // Create ProjectMember record for leader
    await ProjectMember.create({
      project: newProject._id,
      user: leaderId,
      role: 'leader',
      invitationStatus: 'accepted',
      joinedAt: new Date(),
    });

    const populated = await Project.findById(newProject._id)
      .populate('leader', 'name email rollNumber department')
      .populate('teamMembers', 'name email rollNumber department')
      .populate('assignedFaculty', 'name email facultyId department')
      .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive');

    res.status(201).json({
      status: 'success',
      project: populated,
    });
  } catch (error) {
    next(error);
  }
};

// Get my projects (student sees their projects, faculty sees assigned, admin sees all)
const getProjects = async (req, res, next) => {
  try {
    let query = {};

    if (req.user.role === 'student') {
      query.teamMembers = req.user.id;
    } else if (req.user.role === 'faculty') {
      query.assignedFaculty = req.user.id;
    }
    // Admin gets all projects (query is empty)

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const total = await Project.countDocuments(query);
    const projects = await Project.find(query)
      .populate('leader', 'name email rollNumber department section batch academicYear cohortId')
      .populate('teamMembers', 'name email rollNumber department')
      .populate('assignedFaculty', 'name email facultyId department')
      .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      status: 'success',
      projects: projects.map(serializeProjectWithoutReportText),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single project details
const getProjectById = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('leader', 'name email rollNumber department')
      .populate('teamMembers', 'name email rollNumber department')
      .populate('assignedFaculty', 'name email facultyId department')
      .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive')
      .populate('plagiarismResult')
      .populate('evaluation');

    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    // Role-based restrictions
    if (req.user.role === 'student' && !project.teamMembers.some(m => m._id.toString() === req.user.id)) {
      return next(new AppError('You are not authorized to view this project', 403));
    }
    if (req.user.role === 'faculty' && project.assignedFaculty?._id?.toString() !== req.user.id) {
      return next(new AppError('You are not authorized to view this project', 403));
    }

    // Also fetch project members
    const members = await ProjectMember.find({ project: project._id })
      .populate('user', 'name email rollNumber department');

    res.status(200).json({
      status: 'success',
      project: serializeProjectWithoutReportText(project),
      members,
    });
  } catch (error) {
    next(error);
  }
};

// Update a proposal or a legacy draft (leader only)
const updateProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    // Only leader can edit
    if (project.leader.toString() !== req.user.id) {
      return next(new AppError('Only the project leader can edit this project', 403));
    }

    const revisionGrantActive = Boolean(
      project.revisionRequest && project.revisionRequest.active && project.revisionRequest.status === 'granted'
    );
    const proposalRevisionReopened = project.status === 'proposal_created'
      && project.revisionRequest?.phase === 'proposal'
      && project.revisionRequest?.status === 'resolved';
    if (revisionGrantActive && project.revisionRequest?.phase !== 'proposal') {
      await validateProjectDeadline(project, { revision: true });
    }
    const { deadline } = req.body;

    if (deadline) {
      const selectedDeadline = await Deadline.findById(deadline);
      if (!selectedDeadline) {
        return next(new AppError('Selected proposal deadline was not found', 404));
      }
      if ((selectedDeadline.phase || 'final') !== 'final') {
        return next(new AppError('Projects must be associated with a FINAL deadline; phase deadlines are used by stage submissions.', 400));
      }
      if (!selectedDeadline.isActive) {
        return next(new AppError('The selected deadline is no longer active', 400));
      }
      const deadlineBatchValues = getBatchLookupValues(selectedDeadline.batch);
      const studentBatchValues = getBatchLookupValues(req.user.batch);
      if (deadlineBatchValues.length && studentBatchValues.length
        && !deadlineBatchValues.some((value) => studentBatchValues.includes(value))) {
        return next(new AppError('This deadline does not match your cohort batch', 400));
      }
      project.deadline = selectedDeadline._id;
    }

    if (project.assignedFaculty && !revisionGrantActive && !proposalRevisionReopened) {
      return next(new AppError('This project is locked for review. A faculty-approved revision grant is required before editing.', 400));
    }

    if (!['proposal_created', 'draft'].includes(project.status) && !revisionGrantActive && !proposalRevisionReopened) {
      return next(new AppError('This project is locked for review. You can only edit a proposal before a faculty guide is assigned or before it is submitted.', 400));
    }

    if (revisionGrantActive) {
      const allowedFields = getRevisionAllowedFields(project);
      const editableRequestFields = new Set([...PROJECT_EDITABLE_FIELDS, 'projectType', 'semester']);
      const attemptedFields = Object.keys(req.body || {}).filter((field) => editableRequestFields.has(field));
      const blockedFields = attemptedFields.filter((field) => !allowedFields.includes(field));
      if (blockedFields.length > 0) {
        return next(new AppError(`Revision access does not permit editing: ${blockedFields.join(', ')}`, 403));
      }
    }

    if (!revisionGrantActive && !proposalRevisionReopened) {
      const leaderCohortId = getCohortId(req.user);
      if (!leaderCohortId) {
        return next(new AppError('Your academic cohort is not configured. Contact an administrator before editing this project.', 400));
      }
      if (project.cohortId && project.cohortId !== leaderCohortId) {
        return next(new AppError("The project cohort does not match the leader's current academic cohort. Contact an administrator.", 409));
      }
      project.cohortId = leaderCohortId;
      project.department = req.user.department;
      project.section = req.user.section;
      project.batch = req.user.batch;
      project.academicYear = req.user.academicYear;
    }

    const editableFields = [
      'title', 'description', 'projectType', 'semester',
      'abstract', 'problemStatement', 'objectives', 'proposedSolution', 'methodology',
      'expectedOutcome', 'technologies', 'domain', 'keywords',
    ];
    const fieldsToApply = revisionGrantActive
      ? editableFields.filter((field) => getRevisionAllowedFields(project).includes(field) && Object.prototype.hasOwnProperty.call(req.body, field))
      : editableFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));

    fieldsToApply.forEach((field) => {
      project[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
    });

    if (['proposal_created', 'draft'].includes(project.status)) {
      const requiredFields = [
        ['title', 200],
        ['domain', 120],
        ['abstract', 3000],
        ['problemStatement', 5000],
        ['objectives', 5000],
        ['methodology', 5000],
        ['technologies', 1000],
        ['expectedOutcome', 5000],
      ];
      for (const [field, maxLength] of requiredFields) {
        const value = project[field];
        if (typeof value !== 'string' || !value.trim()) {
          return next(new AppError(`${field} is required`, 400));
        }
        if (value.trim().length > maxLength) {
          return next(new AppError(`${field} cannot exceed ${maxLength} characters`, 400));
        }
      }
      project.description = project.problemStatement;
    }

    if (revisionGrantActive && project.revisionRequest?.editableFields?.length) {
      project.revisionRequest.status = 'granted';
      project.revisionRequest.active = true;
    }

    if (!project.title) {
      return next(new AppError('Project title is required', 400));
    }
    if (project.title.length > 200 || (project.abstract && project.abstract.length > 3000)) {
      return next(new AppError('Title must be at most 200 characters and abstract at most 3000 characters', 400));
    }

    await project.save();

    const populatedQuery = Project.findById(project._id);
    const populated = typeof populatedQuery.populate === 'function'
      ? await populatedQuery
        .populate('leader', 'name email rollNumber department')
        .populate('teamMembers', 'name email rollNumber department')
        .populate('assignedFaculty', 'name email facultyId department')
        .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive')
      : project;

    res.status(200).json({
      status: 'success',
      project: populated,
    });
  } catch (error) {
    next(error);
  }
};

// Upload file to project (report/presentation/source)
const uploadProjectFile = async (req, res, next) => {
  let filePersisted = false;
  try {
    if (!req.file) {
      return next(new AppError('No file uploaded', 400));
    }

    const { purpose } = req.body;
    if (!purpose || !['report', 'presentation', 'source'].includes(purpose)) {
      // Clean up uploaded file
      safeUnlink(req.file.path);
      return next(new AppError('File purpose must be one of: report, presentation, source', 400));
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      safeUnlink(req.file.path);
      return next(new AppError('Project not found', 404));
    }

    // Only leader can upload
    if (project.leader.toString() !== req.user.id) {
      safeUnlink(req.file.path);
      return next(new AppError('Only the project leader can upload files', 403));
    }

    const revisionGrantActive = Boolean(
      project.revisionRequest && project.revisionRequest.active && project.revisionRequest.status === 'granted'
    );

    if (project.status === 'proposal_created') {
      safeUnlink(req.file.path);
      return next(new AppError('Document uploads are available only after project proposal approval', 400));
    }

    const allowedFileTypes = Array.isArray(project.revisionRequest?.fileTypes)
      ? project.revisionRequest.fileTypes
      : [];
    if (project.status !== 'faculty_accepted' && !(revisionGrantActive && allowedFileTypes.includes(purpose))) {
      safeUnlink(req.file.path);
      return next(new AppError('Files can only be uploaded after proposal approval or during an active revision grant for the approved file type.', 400));
    }
    await validateProjectDeadline(project, { revision: revisionGrantActive });

    // Validate file extension matches purpose
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const purposeExtMap = {
      report: ['pdf'],
      presentation: ['ppt', 'pptx'],
      source: ['zip'],
    };

    if (!purposeExtMap[purpose].includes(ext)) {
      safeUnlink(req.file.path);
      return next(new AppError(`Invalid file type for purpose "${purpose}". Expected: ${purposeExtMap[purpose].join(', ')}`, 400));
    }

    const extractedData = await validateUploadContent({
      filePath: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      purpose,
    });
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const fieldMap = {
      report: { url: 'reportUrl', hash: 'reportHash', name: 'reportName', storage: 'reportStorageName' },
      presentation: { url: 'pptUrl', hash: 'pptHash', name: 'pptName', storage: 'pptStorageName' },
      source: { url: 'codeZipUrl', hash: 'codeZipHash', name: 'codeZipName', storage: 'codeZipStorageName' },
    };
    const fields = fieldMap[purpose];
    const previousStorageName = project.files[fields.storage];
    const previousFileUrl = project.files[fields.url];
    const previousFilePath = getStoredUploadPath(previousStorageName, previousFileUrl);
    const fileUrl = `/api/projects/${project._id}/files/${purpose}/download`;
    project.files[fields.url] = fileUrl;
    project.files[fields.hash] = fileHash;
    project.files[fields.name] = req.file.originalname;
    project.files[fields.storage] = req.file.filename;
    if (purpose === 'report') {
      project.files.reportText = extractedData.reportText;
      project.files.reportTextStatus = extractedData.reportTextStatus;
      project.files.reportPageCount = extractedData.reportPageCount;
      project.files.reportPagesAnalyzed = extractedData.reportPagesAnalyzed;
      project.files.reportAnalysisVersion = (Number(project.files.reportAnalysisVersion) || 0) + 1;
      project.files.reportAnalyzedAt = new Date();
      project.reportOriginality = null;
    }
    await project.save();
    filePersisted = true;
    const revisionFiles = project.revisionRequest?.snapshotBeforeRevision?.files || {};
    const previousFileIsSnapshotted = revisionGrantActive
      && Object.values(revisionFiles).some((value) => value === previousStorageName || value === previousFileUrl);
    if (previousFilePath && previousFilePath !== req.file.path && !previousFileIsSnapshotted) {
      safeUnlink(previousFilePath);
    }

    res.status(200).json({
      status: 'success',
      url: fileUrl,
      hash: fileHash,
      originalName: req.file.originalname,
      size: req.file.size,
      purpose,
      reportTextStatus: extractedData.reportTextStatus,
    });
  } catch (error) {
    if (!filePersisted) safeUnlink(req.file?.path);
    next(error);
  }
};

const downloadProjectFile = async (req, res, next) => {
  try {
    const fieldsByPurpose = {
      report: { url: 'reportUrl', storage: 'reportStorageName', name: 'reportName' },
      presentation: { url: 'pptUrl', storage: 'pptStorageName', name: 'pptName' },
      source: { url: 'codeZipUrl', storage: 'codeZipStorageName', name: 'codeZipName' },
    };
    const fields = fieldsByPurpose[req.params.purpose];
    if (!fields) return next(new AppError('Invalid project document type', 400));

    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));

    const userId = String(req.user.id || req.user._id);
    const leaderId = String(project.leader?._id || project.leader);
    const memberIds = (project.teamMembers || []).map((member) => String(member?._id || member));
    const assignedFacultyId = String(project.assignedFaculty?._id || project.assignedFaculty || '');
    const authorized = req.user.role === 'admin'
      || (req.user.role === 'student' && (userId === leaderId || memberIds.includes(userId)))
      || (req.user.role === 'faculty' && assignedFacultyId === userId);
    if (!authorized) return next(new AppError('You are not authorized to access this project document', 403));

    let documentFiles = project.files;
    if (req.query?.stagePhase) {
      if (!STAGE_PHASES.has(req.query.stagePhase)) {
        return next(new AppError('Invalid submission phase', 400));
      }
      const stageVersion = (project.stageSubmissions || []).find((submission) => (
        submission.phase === req.query.stagePhase
        && Number(submission.version) === Number(req.query.versionNumber)
      ));
      if (!stageVersion?.files) return next(new AppError('Stage document version is unavailable', 404));
      documentFiles = stageVersion.files;
    } else if (req.query?.versionNumber !== undefined) {
      const versionNumber = Number(req.query.versionNumber);
      const revision = (project.revisionHistory || []).find((version) => Number(version.versionNumber) === versionNumber);
      if (!Number.isInteger(versionNumber) || versionNumber < 1 || !revision?.snapshot?.files) {
        return next(new AppError('Project document version is unavailable', 404));
      }
      documentFiles = revision.snapshot.files;
    }

    const fileUrl = documentFiles?.[fields.url];
    const filePath = getStoredUploadPath(documentFiles?.[fields.storage], fileUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      return next(new AppError('Project document is unavailable', 404));
    }

    const realUploadDir = fs.realpathSync(UPLOAD_DIR);
    const realFilePath = fs.realpathSync(filePath);
    if (!realFilePath.startsWith(`${realUploadDir}${path.sep}`)) {
      return next(new AppError('Project document is unavailable', 404));
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.download(realFilePath, path.basename(documentFiles?.[fields.name] || filePath), (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
};

const getFormalStageReviewQueue = async (req, res, next) => {
  try {
    const filter = req.user.role === 'faculty' ? { assignedFaculty: req.user.id } : {};
    const projects = await Project.find(filter)
      .populate('leader', 'name email rollNumber department batch section')
      .populate('teamMembers', 'name email rollNumber department')
      .populate('assignedFaculty', 'name email facultyId department')
      .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive')
      .sort({ updatedAt: -1 })
      .limit(200);

    const submissions = [];
    projects.forEach((project) => {
      const versions = project.stageSubmissions || [];
      const latestByPhase = new Map();
      versions.forEach((submission) => {
        const current = latestByPhase.get(submission.phase);
        if (!current || Number(submission.version) > Number(current.version)) {
          latestByPhase.set(submission.phase, submission);
        }
      });
      [...latestByPhase.values()]
        .filter((submission) => (
          ['submitted', 'resubmitted'].includes(submission.status)
          || (submission.status === 'changes_requested' && !submission.revisionAccessGranted)
        )
          && hasRequiredStageFiles(submission, submission.phase))
        .forEach((submission) => submissions.push({
          project: serializeProjectWithoutReportText(project),
          phase: submission.phase,
          version: submission.version,
          status: submission.status,
          submittedAt: submission.submittedAt,
          reviewDecision: submission.reviewDecision,
          feedback: submission.feedback,
          files: getProjectFilesSnapshot(submission.files),
          reportOriginality: submission.reportOriginality,
        }));

      const hasFinalStage = versions.some((submission) => submission.phase === 'final');
      if (!hasFinalStage
        && ['submitted', 'under_review', 'resubmitted'].includes(project.status)
        && hasRequiredStageFiles({ files: project.files }, 'final', false)) {
        submissions.push({
          project: serializeProjectWithoutReportText(project),
          phase: 'final',
          version: 0,
          status: project.status === 'resubmitted' ? 'resubmitted' : 'submitted',
          submittedAt: project.submittedAt,
          reviewDecision: null,
          feedback: project.facultyComment || '',
          files: getProjectFilesSnapshot(project.files),
          deploymentUrl: project.deploymentUrl || '',
          reportOriginality: project.reportOriginality,
          legacy: true,
        });
      }
    });

    submissions.sort((left, right) => new Date(right.submittedAt || 0) - new Date(left.submittedAt || 0));
    res.status(200).json({ status: 'success', submissions });
  } catch (error) {
    next(error);
  }
};

const getProposalReviewProjects = async (req, res, next) => {
  try {
    const filter = {
      $or: [
        { status: { $in: ['uniqueness_checked', 'faculty_review', 'faculty_changes_requested'] } },
        { status: 'revision_required', 'revisionRequest.phase': 'proposal' },
        { 'revisionAccessRequest.status': 'pending' },
      ],
    };
    if (req.user.role === 'faculty') filter.assignedFaculty = req.user.id;
    const projects = await Project.find(filter)
      .populate('leader', 'name email rollNumber department batch section')
      .populate('teamMembers', 'name email rollNumber department')
      .populate('assignedFaculty', 'name email facultyId department')
      .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive')
      .sort({ updatedAt: -1 });
    res.status(200).json({ status: 'success', projects: projects.map(serializeProjectWithoutReportText) });
  } catch (error) {
    next(error);
  }
};

const uploadStageFile = async (req, res, next) => {
  let saved = false;
  try {
    const { phase } = req.params;
    const purpose = req.body.purpose || 'report';
    if (!req.file) return next(new AppError('No file uploaded', 400));
    const allowedPurposes = phase === 'final'
      ? ['report', 'presentation', 'source']
      : ['abstract', 'midterm'].includes(phase) ? ['report', 'presentation'] : [];
    if (!allowedPurposes.includes(purpose)) {
      safeUnlink(req.file.path);
      return next(new AppError('This review does not accept that document type.', 400));
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      safeUnlink(req.file.path);
      return next(new AppError('Project not found', 404));
    }
    if (String(project.leader?._id || project.leader) !== String(req.user.id)) {
      safeUnlink(req.file.path);
      return next(new AppError('Only the project leader can submit stage documents', 403));
    }
    if (project.status !== 'faculty_accepted') {
      safeUnlink(req.file.path);
      return next(new AppError('Proposal approval is required before stage documents can be submitted', 400));
    }

    const latest = getLatestStageSubmission(project, phase);
    if (phase === 'midterm' && getLatestStageSubmission(project, 'abstract')?.status !== 'approved') {
      safeUnlink(req.file.path);
      return next(new AppError('Abstract stage approval is required before midterm submission', 400));
    }
    if (phase === 'final' && getLatestStageSubmission(project, 'midterm')?.status !== 'approved') {
      safeUnlink(req.file.path);
      return next(new AppError('Midterm stage approval is required before final submission', 400));
    }
    if (latest?.status === 'approved' || ['submitted', 'resubmitted'].includes(latest?.status)) {
      safeUnlink(req.file.path);
      return next(new AppError('This phase is awaiting faculty review or has already been approved', 409));
    }

    const revisionSource = latest?.status === 'changes_requested'
      ? latest
      : latest?.resubmissionOfVersion
        ? (project.stageSubmissions || []).find((submission) => (
          submission.phase === phase && Number(submission.version) === Number(latest.resubmissionOfVersion)
        ))
        : null;
    const isRevision = revisionSource?.status === 'changes_requested';
    if (isRevision && !revisionSource.revisionAccessGranted) {
      safeUnlink(req.file.path);
      return next(new AppError('Faculty revision access has not been granted for this phase', 403));
    }
    if (isRevision && Array.isArray(revisionSource.revisionFileTypes)
      && !revisionSource.revisionFileTypes.includes(purpose)) {
      safeUnlink(req.file.path);
      return next(new AppError(`Faculty did not authorize a ${purpose} revision for this version`, 403));
    }
    await validateProjectDeadline(project, {
      phase,
      revision: isRevision,
      revisionDueDate: revisionSource?.revisionDueDate,
    });

    const extracted = await validateUploadContent({
      filePath: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      purpose,
    });
    const buffer = fs.readFileSync(req.file.path);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    let current = latest?.status === 'draft' ? latest : null;
    if (!current) {
      const nextVersion = Math.max(0, ...(project.stageSubmissions || [])
        .filter((submission) => submission.phase === phase)
        .map((submission) => Number(submission.version) || 0)) + 1;
      const retainedFiles = revisionSource?.files?.toObject
        ? revisionSource.files.toObject()
        : { ...(revisionSource?.files || {}) };
      project.stageSubmissions.push({
        phase,
        version: nextVersion,
        status: 'draft',
        resubmissionOfVersion: isRevision ? revisionSource.version : undefined,
        deploymentUrl: isRevision ? revisionSource.deploymentUrl : undefined,
        files: isRevision ? retainedFiles : {},
      });
      current = project.stageSubmissions[project.stageSubmissions.length - 1];
    }

    const fileFields = {
      report: { url: 'reportUrl', hash: 'reportHash', name: 'reportName', storage: 'reportStorageName' },
      presentation: { url: 'pptUrl', hash: 'pptHash', name: 'pptName', storage: 'pptStorageName' },
      source: { url: 'codeZipUrl', hash: 'codeZipHash', name: 'codeZipName', storage: 'codeZipStorageName' },
    }[purpose];
    const oldStorageName = current.files[fileFields.storage];
    const fileUrl = `/api/projects/${project._id}/files/${purpose}/download?stagePhase=${phase}&versionNumber=${current.version}`;
    Object.assign(current.files, {
      [fileFields.url]: fileUrl,
      [fileFields.hash]: hash,
      [fileFields.name]: req.file.originalname,
      [fileFields.storage]: req.file.filename,
      ...(purpose === 'report' ? {
        reportText: extracted.reportText,
        reportTextStatus: extracted.reportTextStatus,
        reportPageCount: extracted.reportPageCount,
        reportPagesAnalyzed: extracted.reportPagesAnalyzed,
        reportAnalysisVersion: 1,
        reportAnalyzedAt: new Date(),
      } : {}),
    });
    if (purpose === 'report') current.reportOriginality = null;
    await project.save();
    saved = true;

    if (oldStorageName && oldStorageName !== req.file.filename) {
      const referenced = (project.stageSubmissions || []).some((submission) => (
        submission !== current && submission.files?.reportStorageName === oldStorageName
      ));
      if (!referenced) safeUnlink(getStoredUploadPath(oldStorageName));
    }
    res.status(200).json({
      status: 'success',
      phase,
      version: current.version,
      url: fileUrl,
      hash,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  } catch (error) {
    if (!saved) safeUnlink(req.file?.path);
    next(error);
  }
};

const submitStage = async (req, res, next) => {
  try {
    const { phase } = req.params;
    if (!STAGE_PHASES.has(phase)) return next(new AppError('Invalid submission phase', 400));
    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    if (String(project.leader?._id || project.leader) !== String(req.user.id)) {
      return next(new AppError('Only the project leader can submit a stage', 403));
    }
    if (project.status !== 'faculty_accepted') return next(new AppError('Proposal approval is required before stage submission', 400));
    if (phase === 'midterm' && getLatestStageSubmission(project, 'abstract')?.status !== 'approved') {
      return next(new AppError('Abstract stage approval is required before midterm submission', 400));
    }
    if (phase === 'final' && getLatestStageSubmission(project, 'midterm')?.status !== 'approved') {
      return next(new AppError('Midterm stage approval is required before final submission', 400));
    }

    const current = getLatestStageSubmission(project, phase);
    if (!current || current.status !== 'draft') {
      return next(new AppError('Upload the required documents before submitting this phase', 400));
    }
    const priorVersion = current.resubmissionOfVersion
      ? (project.stageSubmissions || []).find((item) => item.phase === phase && item.version === current.resubmissionOfVersion)
      : null;
    const isRevision = Boolean(priorVersion);
    if (isRevision && (priorVersion.status !== 'changes_requested' || !priorVersion.revisionAccessGranted)) {
      return next(new AppError('Faculty revision access is not active for this phase', 403));
    }
    if (phase === 'final') {
      const deploymentUrl = String(req.body?.deploymentUrl || current.deploymentUrl || '').trim();
      if (!isValidHttpUrl(deploymentUrl)) {
        return next(new AppError('A valid HTTP or HTTPS deployment URL is required for final review', 400));
      }
      if (priorVersion
        && deploymentUrl !== String(current.deploymentUrl || '').trim()
        && !priorVersion.revisionFileTypes?.includes('deploymentUrl')) {
        return next(new AppError('Faculty did not authorize a deployment URL revision for this version', 403));
      }
      current.deploymentUrl = deploymentUrl;
    }
    if (!hasRequiredStageFiles(current, phase)) {
      return next(new AppError(phase === 'final'
        ? 'Upload the final report, presentation, source ZIP, and a valid deployment URL before submitting'
        : 'Upload the required PDF report and presentation before submitting this review', 400));
    }
    await validateProjectDeadline(project, {
      phase,
      revision: isRevision,
      revisionDueDate: priorVersion?.revisionDueDate,
    });

    const previousState = {
      status: current.status,
      submittedAt: current.submittedAt,
      reportOriginality: current.reportOriginality,
    };
    current.status = isRevision ? 'resubmitted' : 'submitted';
    current.submittedAt = new Date();
    if (isRevision && priorVersion) priorVersion.revisionAccessGranted = false;
    try {
      if (current.files.reportUrl) {
        current.reportOriginality = await buildReportOriginalityResult({
          ...serializeProjectWithoutReportText(project),
          files: current.files,
        });
      }
      await project.save();
    } catch (error) {
      current.status = previousState.status;
      current.submittedAt = previousState.submittedAt;
      current.reportOriginality = previousState.reportOriginality;
      if (isRevision && priorVersion) priorVersion.revisionAccessGranted = true;
      throw error;
    }

    if (isRevision) {
      current.reviewDecision = undefined;
      current.reviewedBy = undefined;
      current.reviewedAt = undefined;
    }

    res.status(200).json({
      status: 'success',
      project: serializeProjectWithoutReportText(project),
      submission: current,
    });
  } catch (error) {
    next(error);
  }
};

const saveStageDraft = async (req, res, next) => {
  try {
    const { phase } = req.params;
    if (!STAGE_PHASES.has(phase)) return next(new AppError('Invalid submission phase', 400));
    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    if (String(project.leader?._id || project.leader) !== String(req.user.id)) {
      return next(new AppError('Only the project leader can save a stage draft', 403));
    }
    if (project.status !== 'faculty_accepted') return next(new AppError('Proposal approval is required before saving stage drafts', 400));
    if (phase === 'midterm' && getLatestStageSubmission(project, 'abstract')?.status !== 'approved') {
      return next(new AppError('Abstract stage approval is required before midterm submission', 400));
    }
    if (phase === 'final' && getLatestStageSubmission(project, 'midterm')?.status !== 'approved') {
      return next(new AppError('Midterm stage approval is required before final submission', 400));
    }
    const current = getLatestStageSubmission(project, phase);
    if (!current || current.status !== 'draft') {
      return next(new AppError('Only an active draft can be saved', 400));
    }
    const priorVersion = current.resubmissionOfVersion
      ? (project.stageSubmissions || []).find((item) => item.phase === phase && item.version === current.resubmissionOfVersion)
      : null;
    if (priorVersion && (priorVersion.status !== 'changes_requested' || !priorVersion.revisionAccessGranted)) {
      return next(new AppError('Faculty revision access is not active for this phase', 403));
    }
    await validateProjectDeadline(project, {
      phase,
      revision: Boolean(priorVersion),
      revisionDueDate: priorVersion?.revisionDueDate,
    });
    if (phase === 'final' && req.body?.deploymentUrl !== undefined) {
      const deploymentUrl = String(req.body.deploymentUrl || '').trim();
      if (deploymentUrl && !isValidHttpUrl(deploymentUrl)) {
        return next(new AppError('Deployment URL must be a valid HTTP or HTTPS URL', 400));
      }
      if (priorVersion && !priorVersion.revisionFileTypes?.includes('deploymentUrl')) {
        return next(new AppError('Faculty did not authorize a deployment URL revision for this version', 403));
      }
      current.deploymentUrl = deploymentUrl;
    }
    current.draftSavedAt = new Date();
    await project.save();
    res.status(200).json({ status: 'success', submission: current });
  } catch (error) {
    next(error);
  }
};

const reviewStageSubmission = async (req, res, next) => {
  try {
    const { phase, version } = req.params;
    const { decision, feedback, revisionDueDate } = req.body;
    if (!STAGE_PHASES.has(phase)) return next(new AppError('Invalid submission phase', 400));
    if (!['approved', 'changes_requested'].includes(decision)) return next(new AppError('Decision must be approved or changes_requested', 400));
    if (decision === 'changes_requested' && !String(feedback || '').trim()) {
      return next(new AppError('Feedback is required when requesting changes', 400));
    }
    const allowedPhaseFiles = phase === 'final'
      ? ['report', 'presentation', 'source', 'deploymentUrl']
      : ['report', 'presentation'];
    const revisionFileTypes = Array.isArray(req.body.revisionFileTypes)
      ? [...new Set(req.body.revisionFileTypes.filter((fileType) => allowedPhaseFiles.includes(fileType)))]
      : [];
    if (decision === 'changes_requested' && revisionFileTypes.length === 0) {
      return next(new AppError('Select at least one file type the student may revise', 400));
    }
    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    if (!isAssignedReviewer(project, req.user)) return next(new AppError('Only the assigned faculty member or an admin can review this stage', 403));
    const submission = (project.stageSubmissions || []).find((item) => item.phase === phase && Number(item.version) === Number(version));
    if (!submission || !['submitted', 'resubmitted'].includes(submission.status) || !hasRequiredStageFiles(submission, phase)) {
      return next(new AppError('This stage version is not awaiting faculty review', 400));
    }
    if (decision === 'approved' && !submission.rubricEvaluation?.isPublished) {
      return next(new AppError('Save and publish the rubric evaluation for this version before sign-off', 400));
    }
    const parsedRevisionDueDate = revisionDueDate ? new Date(revisionDueDate) : null;
    if (revisionDueDate && Number.isNaN(parsedRevisionDueDate.getTime())) {
      return next(new AppError('Revision deadline must be a valid date', 400));
    }
    submission.status = decision === 'approved' ? 'approved' : 'changes_requested';
    submission.reviewDecision = decision;
    submission.feedback = String(feedback || '').trim();
    submission.reviewedBy = req.user.id || req.user._id;
    submission.reviewedAt = new Date();
    submission.revisionDueDate = decision === 'changes_requested' ? parsedRevisionDueDate : undefined;
    submission.revisionAccessGranted = false;
    submission.revisionFileTypes = decision === 'changes_requested' ? revisionFileTypes : [];
    if (decision === 'approved' && phase === 'final') project.status = 'evaluated';
    await project.save();
    res.status(200).json({ status: 'success', submission });
  } catch (error) {
    next(error);
  }
};

const grantStageRevisionAccess = async (req, res, next) => {
  try {
    const { phase, version } = req.params;
    const project = await Project.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    if (!isAssignedReviewer(project, req.user)) return next(new AppError('Only the assigned faculty member or an admin can grant revision access', 403));
    const submission = (project.stageSubmissions || []).find((item) => item.phase === phase && Number(item.version) === Number(version));
    if (!submission || submission.status !== 'changes_requested') {
      return next(new AppError('Revision access can only be granted for a stage with requested changes', 400));
    }
    await validateProjectDeadline(project, {
      phase,
      revision: true,
      revisionDueDate: submission.revisionDueDate,
    });
    submission.revisionAccessGranted = true;
    submission.revisionGrantedBy = req.user.id || req.user._id;
    submission.revisionGrantedAt = new Date();
    await project.save();
    res.status(200).json({ status: 'success', submission });
  } catch (error) {
    next(error);
  }
};

const runUniquenessCheck = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    if (project.leader.toString() !== req.user.id) {
      return next(new AppError('Only the project leader can run a similarity check', 403));
    }

    const currentText = getUsableComparisonText(project);
    if (!currentText || currentText.split(/\s+/).filter(Boolean).length < 4) {
      project.uniquenessCheck = {
        status: 'insufficient_text',
        checkedAt: new Date(),
        algorithm: 'No comparison (insufficient text)',
        overallScore: 0,
        semanticStatus: 'not_attempted',
        scoreMethod: 'No similarity score is available because the project text is insufficient.',
        result: results.insufficientText,
        matches: [],
      };
      await project.save();

      return res.status(200).json({
        status: 'success',
        result: project.uniquenessCheck,
      });
    }

    project.uniquenessCheck = {
      status: 'checking',
      checkedAt: new Date(),
      algorithm: 'Check in progress',
      overallScore: 0,
      semanticStatus: 'not_attempted',
      scoreMethod: 'Comparison is in progress.',
      result: results.likelyUnique,
      matches: [],
    };
    await project.save();

    const candidateProjectsResult = await Project.find({
      _id: { $ne: project._id },
      status: { $nin: ['withdrawn', 'rejected'] },
      $or: comparisonFields.map((field) => ({ [field]: { $exists: true, $ne: '' } })),
    });
    const candidateProjects = Array.isArray(candidateProjectsResult)
      ? candidateProjectsResult
      : await candidateProjectsResult.select('_id title domain abstract problemStatement objectives methodology technologies expectedOutcome description cohortId status');

    const eligibleProjects = candidateProjects.filter((candidate) => {
      if (!candidate || candidate._id.toString() === project._id.toString()) return false;
      const candidateText = getUsableComparisonText(candidate);
      return candidateText && candidateText.split(/\s+/).filter(Boolean).length >= 4;
    });

    const documents = [currentText, ...eligibleProjects.map((candidate) => getUsableComparisonText(candidate))];
    const { vectors } = createTfIdfVectors(documents);
    const projectVector = vectors[0];
    let semanticAttempts = 0;
    let semanticAvailableCount = 0;
    let semanticUnavailableCount = 0;
    const matches = eligibleProjects
      .map((candidate, index) => {
        const candidateText = getUsableComparisonText(candidate);
        const candidateVector = vectors[index + 1];
        const lexicalSimilarity = calculateCosineSimilarity(projectVector, candidateVector);
        const semanticComparison = computeSemanticSimilarity(currentText, candidateText);
        const textSimilarity = Math.min(1, Math.max(0, Number(lexicalSimilarity) || 0));
        const hasSemanticScore = semanticComparison.semanticAvailable === true
          && semanticComparison.score !== null
          && semanticComparison.score !== undefined
          && Number.isFinite(Number(semanticComparison.score));
        const semanticScore = hasSemanticScore
          ? Math.min(1, Math.max(0, Number(semanticComparison.score)))
          : null;
        if (semanticComparison.attempted) semanticAttempts += 1;
        if (hasSemanticScore) semanticAvailableCount += 1;
        else semanticUnavailableCount += 1;
        const textWeight = hasSemanticScore ? 0.65 : 1;
        const semanticWeight = hasSemanticScore ? 0.35 : 0;
        const textSimilarityPercent = Number((textSimilarity * 100).toFixed(2));
        const semanticSimilarityPercent = semanticScore === null ? null : Number((semanticScore * 100).toFixed(2));
        const combinedSimilarityPercent = Math.min(100, Math.max(0,
          (textSimilarityPercent * textWeight) + ((semanticSimilarityPercent || 0) * semanticWeight)));
        const combinedSimilarity = combinedSimilarityPercent / 100;
        const sectionComparisons = compareProjectSections(project, candidate);
        const sharedSignals = [...new Set(sectionComparisons.flatMap((section) => section.matchingTerms))].slice(0, 5);
        const scoreBreakdown = {
          textSimilarity: textSimilarityPercent,
          semanticSimilarity: semanticSimilarityPercent,
          combinedSimilarity: Number(combinedSimilarityPercent.toFixed(2)),
          textWeight: Number((textWeight * 100).toFixed(0)),
          semanticWeight: Number((semanticWeight * 100).toFixed(0)),
        };

        const finalSimilarityScore = Math.round(combinedSimilarity * 100);
        return {
          projectId: candidate._id,
          title: candidate.title,
          domain: candidate.domain,
          similarityScore: finalSimilarityScore,
          textSimilarity: scoreBreakdown.textSimilarity,
          semanticSimilarity: scoreBreakdown.semanticSimilarity,
          scoreBreakdown,
          semanticStatus: hasSemanticScore ? 'available' : 'unavailable',
          semanticReason: semanticComparison.reason,
          sectionComparisons,
          sharedSignals,
          evidence: semanticComparison.evidence || 'Text similarity was calculated using TF-IDF + cosine similarity.',
          explanation: buildTextSimilarityExplanation({
            textSimilarity: scoreBreakdown.textSimilarity,
            semanticSimilarity: scoreBreakdown.semanticSimilarity,
            sharedSignals,
            evidence: semanticComparison.evidence || 'Text similarity was calculated using TF-IDF + cosine similarity.',
          }),
        };
      })
      .filter((candidate) => candidate.similarityScore > 0)
      .sort((left, right) => right.similarityScore - left.similarityScore)
      .slice(0, 5);

    const overallScore = matches.length > 0 ? matches[0].similarityScore : 0;
    const result = determineSimilarityResult(overallScore);
    const semanticStatus = semanticAvailableCount === 0
      ? (eligibleProjects.length ? 'unavailable' : 'not_attempted')
      : semanticAvailableCount < eligibleProjects.length ? 'partial' : 'available';
    const algorithmLabel = semanticAvailableCount > 0
      ? `${algorithm} + Sentence-BERT (${semanticAvailableCount}/${eligibleProjects.length} comparisons)`
      : semanticAttempts > 0
        ? `${algorithm} (Sentence-BERT unavailable; ${semanticAttempts} attempts)`
        : eligibleProjects.length > 0
          ? `${algorithm} (Sentence-BERT disabled)`
          : algorithm;
    const scoreMethod = semanticStatus === 'available'
      ? 'Overall score is the highest matched-project score; each comparison uses 65% TF-IDF cosine and 35% Sentence-BERT.'
      : semanticStatus === 'partial'
        ? 'Overall score is the highest matched-project score; per-comparison weights reflect whether Sentence-BERT succeeded.'
        : 'Overall score is the highest matched-project score using TF-IDF cosine only (100% text) because semantic similarity was unavailable.';

    project.uniquenessCheck = {
      status: 'completed',
      checkedAt: new Date(),
      algorithm: algorithmLabel,
      overallScore,
      semanticStatus,
      scoreMethod,
      result,
      matches: matches.map((match) => ({
        projectId: match.projectId,
        title: match.title,
        domain: match.domain,
        similarityScore: match.similarityScore,
        textSimilarity: match.textSimilarity,
        semanticSimilarity: match.semanticSimilarity,
        scoreBreakdown: match.scoreBreakdown,
        semanticStatus: match.semanticStatus,
        semanticReason: match.semanticReason,
        sectionComparisons: match.sectionComparisons,
        sharedSignals: match.sharedSignals,
        evidence: match.evidence,
        explanation: match.explanation,
      })),
    };
    project.status = 'uniqueness_checked';
    await project.save();

    res.status(200).json({
      status: 'success',
      result: project.uniquenessCheck,
    });
  } catch (error) {
    const project = await Project.findById(req.params.id).catch(() => null);
    if (project) {
      project.uniquenessCheck = {
        status: 'failed',
        checkedAt: new Date(),
        algorithm: 'No completed comparison (check failed)',
        overallScore: 0,
        semanticStatus: 'not_attempted',
        scoreMethod: 'No score is available because the check failed before comparisons completed.',
        result: results.likelyUnique,
        matches: [],
      };
      await project.save().catch(() => {});
    }
    return next(new AppError(`Similarity check failed while comparing project proposals: ${error.message}`, 500));
  }
};

const getFacultyReviewProjects = async (req, res, next) => {
  return getFormalStageReviewQueue(req, res, next);
};

const submitProposalForReview = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    if (project.leader.toString() !== req.user.id) {
      return next(new AppError('Only the project leader can submit this proposal for review', 403));
    }
    if (project.status !== 'proposal_created') {
      return next(new AppError('This proposal has already been submitted for review or is not eligible', 409));
    }

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
    for (const [field, maxLength] of Object.entries(proposalLimits)) {
      const value = field === 'problemStatement'
        ? project.problemStatement || project.description
        : project[field];
      if (typeof value !== 'string' || !value.trim()) {
        return next(new AppError(`${field} is required before proposal review`, 400));
      }
      if (value.trim().length > maxLength) {
        return next(new AppError(`${field} cannot exceed ${maxLength} characters`, 400));
      }
    }

    const claim = await Project.findOneAndUpdate(
      { _id: project._id, status: 'proposal_created', 'uniquenessCheck.status': { $ne: 'checking' } },
      { $set: { 'uniquenessCheck.status': 'checking', 'uniquenessCheck.checkedAt': new Date() } },
      { new: true }
    );
    if (!claim) {
      return next(new AppError('This proposal has already been submitted for review or is being processed', 409));
    }

    let checkResponseBody;
    let checkError;
    const checkResponse = {
      status() { return this; },
      json(body) { checkResponseBody = body; return this; },
    };
    await runUniquenessCheck(req, checkResponse, (error) => { checkError = error; });
    if (checkError) {
      return next(checkError);
    }
    if (checkResponseBody?.result?.status !== 'completed') {
      return next(new AppError('Add more proposal detail before submitting it for faculty review', 400));
    }

    project.status = 'uniqueness_checked';
    project.uniquenessCheck = checkResponseBody.result;
    res.status(200).json({
      status: 'success',
      message: 'Proposal submitted for faculty review.',
      project,
      result: checkResponseBody.result,
    });
  } catch (error) {
    next(error);
  }
};

const reviewProject = async (req, res, next) => {
  try {
    const { decision, facultyComment } = req.body;
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (!['faculty', 'admin'].includes(req.user.role)) {
      return next(new AppError('Only faculty or admin users can review projects', 403));
    }
    if (req.user.role === 'faculty'
      && String(project.assignedFaculty?._id || project.assignedFaculty || '') !== String(req.user.id)) {
      return next(new AppError('You are not assigned to review this project', 403));
    }
    if (!['uniqueness_checked', 'faculty_review', 'faculty_changes_requested'].includes(project.status)) {
      return next(new AppError('Proposal review is only available for a proposal awaiting faculty approval', 400));
    }
    if (!['accepted', 'changes_requested', 'rejected'].includes(decision)) {
      return next(new AppError('Decision must be accepted, changes_requested, or rejected', 400));
    }
    if (['changes_requested', 'rejected'].includes(decision) && (!facultyComment || !String(facultyComment).trim())) {
      return next(new AppError('A faculty comment is required when requesting changes or rejecting a proposal', 400));
    }

    project.reviewedBy = req.user.id;
    project.reviewedAt = new Date();
    project.reviewDecision = decision;
    project.facultyComment = facultyComment ? String(facultyComment).trim() : '';
    project.status = decision === 'accepted'
      ? 'faculty_accepted'
      : decision === 'rejected' ? 'rejected' : 'faculty_changes_requested';
    await project.save();

    res.status(200).json({
      status: 'success',
      message: decision === 'accepted'
        ? 'Project proposal approved; Review 1 is the next stage.'
        : decision === 'rejected' ? 'Project proposal rejected.' : 'Changes requested from the student team.',
      project,
    });
  } catch (error) {
    next(error);
  }
};

// Submit an approved proposal during its configured submission window.
const submitProject = async (req, res, next) => {
  try {
    let projectId = req.params.id || req.body.projectId;
    let project;

    if (!projectId) {
      return next(new AppError('Create a project proposal before starting a submission stage', 400));
    }

    if (projectId) {
      project = await Project.findById(projectId);
      if (!project) {
        return next(new AppError('Project not found', 404));
      }

      // Only leader can submit
      if (project.leader.toString() !== req.user.id) {
        return next(new AppError('Only the project leader can submit this project', 403));
      }

      if (project.stageWorkflowEnabled) {
        return next(new AppError('Use the phase-specific review workflow to submit Review 3 documents', 400));
      }

      if (project.status === 'withdrawn') {
        return next(new AppError('Cannot submit a withdrawn project', 400));
      }

      if (project.status === 'submitted') {
        return res.status(200).json({ status: 'success', project: serializeProjectWithoutReportText(project) });
      }

      if (project.status === 'evaluated') {
        return next(new AppError('Project has already been evaluated', 400));
      }

      if (!FORMAL_SUBMISSION_STATUSES.has(project.status)) {
        return next(new AppError('This project is not eligible for formal submission yet', 400));
      }
      if (project.stageWorkflowEnabled && getLatestStageSubmission(project, 'abstract')?.status !== 'approved') {
        return next(new AppError('Faculty approval of the ABSTRACT stage is required before FINAL submission', 400));
      }
      if (project.stageWorkflowEnabled && getLatestStageSubmission(project, 'midterm')?.status !== 'approved') {
        return next(new AppError('Faculty approval of the MIDTERM stage is required before FINAL submission', 400));
      }
    }

    const now = new Date();
    await validateProjectDeadline(project, { now });

    if (!project.title?.trim() || !project.abstract?.trim()) {
      return next(new AppError('Project title and abstract are required before submission', 400));
    }

    const pendingInvitation = await TeamInvitation.findOne({
      project: project._id,
      status: 'pending',
      expiresAt: { $gt: now },
    });
    if (pendingInvitation) {
      return next(new AppError('Resolve pending team invitations before submitting the project', 400));
    }

    const acceptedMembers = await ProjectMember.countDocuments({
      project: project._id,
      user: { $in: project.teamMembers },
      invitationStatus: 'accepted',
    });
    if (acceptedMembers !== project.teamMembers.length) {
      return next(new AppError('Project team membership is incomplete. Refresh the team and try again.', 400));
    }

    // Validate all three files are uploaded
    if (!project.files.reportUrl) {
      return next(new AppError('Project report (PDF) is required before submission', 400));
    }
    if (!project.files.pptUrl) {
      return next(new AppError('Project presentation (PPT/PPTX) is required before submission', 400));
    }
    if (!project.files.codeZipUrl) {
      return next(new AppError('Project source code (ZIP) is required before submission', 400));
    }
    const finalDeploymentUrl = String(req.body.deploymentUrl || project.deploymentUrl || '').trim();
    if (!isValidHttpUrl(finalDeploymentUrl)) {
      return next(new AppError('A valid HTTP or HTTPS deployment URL is required for FINAL review', 400));
    }

    // Run plagiarism check
    const previousReportOriginality = project.reportOriginality;
    const previousDeploymentUrl = project.deploymentUrl;
    const plagiarismResult = await runPlagiarismCheck(project._id);
    if (plagiarismResult) {
      project.plagiarismResult = plagiarismResult._id;
      project.plagiarismScore = plagiarismResult.similarityScore;
    }

    try {
      project.reportOriginality = await buildReportOriginalityResult(project);
    } catch {
      project.reportOriginality = {
        status: 'failed',
        reportHash: project.files?.reportHash || '',
        checkedAt: new Date(),
        overallScore: null,
        semanticStatus: 'not_attempted',
        algorithm: 'Report analysis did not complete',
        scoreMethod: 'No report similarity score is available because portal comparison failed.',
        comparisonCoverage: { pagesAnalyzed: 0, pagesAvailable: project.files?.reportPageCount || 0, projectsCompared: 0 },
        matches: [],
      };
    }

    const previousSubmissionState = {
      status: project.status,
      submittedAt: project.submittedAt,
      reportOriginality: previousReportOriginality,
      deploymentUrl: previousDeploymentUrl,
      stageSubmissionCount: project.stageSubmissions?.length || 0,
    };
    if (!Array.isArray(project.stageSubmissions)) project.stageSubmissions = [];
    project.status = 'submitted';
    project.submittedAt = now;
    project.deploymentUrl = finalDeploymentUrl;
    const finalVersion = Math.max(0, ...(project.stageSubmissions || [])
      .filter((submission) => submission.phase === 'final')
      .map((submission) => Number(submission.version) || 0)) + 1;
    const finalFiles = project.files?.toObject ? project.files.toObject() : { ...project.files };
    finalFiles.reportUrl = `/api/projects/${project._id}/files/report/download?stagePhase=final&versionNumber=${finalVersion}`;
    finalFiles.pptUrl = `/api/projects/${project._id}/files/presentation/download?stagePhase=final&versionNumber=${finalVersion}`;
    finalFiles.codeZipUrl = `/api/projects/${project._id}/files/source/download?stagePhase=final&versionNumber=${finalVersion}`;
    project.stageSubmissions.push({
      phase: 'final',
      version: finalVersion,
      files: finalFiles,
      deploymentUrl: finalDeploymentUrl,
      status: 'submitted',
      submittedAt: now,
      reportOriginality: project.reportOriginality,
    });
    try {
      await project.save();
    } catch (error) {
      project.status = previousSubmissionState.status;
      project.submittedAt = previousSubmissionState.submittedAt;
      project.reportOriginality = previousSubmissionState.reportOriginality;
      project.deploymentUrl = previousSubmissionState.deploymentUrl;
      project.stageSubmissions.splice(previousSubmissionState.stageSubmissionCount);
      throw error;
    }

    let populated = project;
    try {
      const teamMembers = await User.find({ _id: { $in: project.teamMembers } });
      await Promise.all(teamMembers.map((member) => Notification.create({
        recipient: member._id,
        type: 'project_submitted',
        title: 'Project Submitted',
        message: `Project "${project.title}" has been submitted successfully.`,
        relatedProject: project._id,
      }).catch(() => null)));
      await sendEmailAlert(
        teamMembers.map((member) => member.email).join(','),
        `Project Submitted: ${project.title}`,
        `Your project "${project.title}" has been successfully submitted.`,
        `<h3>Submission Confirmation</h3><p>Your project <b>${project.title}</b> was recorded at ${now.toLocaleString()}.</p>`
      ).catch(() => null);
    } catch {
      // The project status is already committed; notification failures must not turn submission into a reported failure.
    }

    try {
      populated = await Project.findById(project._id)
        .populate('leader', 'name email rollNumber department')
        .populate('teamMembers', 'name email rollNumber department')
        .populate('deadline', 'title batch phase submissionStartDate submissionEndDate isActive')
        .populate('plagiarismResult');
    } catch {
      populated = project;
    }

    res.status(200).json({
      status: 'success',
      project: serializeProjectWithoutReportText(populated),
    });
  } catch (error) {
    next(error);
  }
};

// Withdraw project (student leader only)
const withdrawProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (project.leader.toString() !== req.user.id) {
      return next(new AppError('Only the project leader can withdraw this project', 403));
    }

    if (project.status === 'evaluated') {
      return next(new AppError('Evaluated projects cannot be withdrawn', 400));
    }

    if (project.status === 'withdrawn') {
      return next(new AppError('Project is already withdrawn', 400));
    }

    project.status = 'withdrawn';
    await project.save();

    // Notify team members
    const teamMembers = await User.find({ _id: { $in: project.teamMembers } });
    for (const member of teamMembers) {
      await Notification.create({
        recipient: member._id,
        type: 'project_status',
        title: 'Project Withdrawn',
        message: `Project "${project.title}" has been withdrawn by the leader.`,
        relatedProject: project._id,
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Project withdrawn successfully',
      project,
    });
  } catch (error) {
    next(error);
  }
};

// Get active deadlines for student
const getStudentDeadlines = async (req, res, next) => {
  try {
    const query = { isActive: true };
    if (req.query.projectId) {
      if (!mongoose.isValidObjectId(req.query.projectId)) {
        return next(new AppError('Invalid project ID for deadline lookup', 400));
      }
      const project = await Project.findById(req.query.projectId).populate('deadline', 'batch');
      if (!project) return next(new AppError('Project not found', 404));
      const isProjectMember = (project.teamMembers || []).some((member) => (
        String(member?._id || member) === String(req.user.id)
      ));
      if (req.user.role === 'student' && !isProjectMember) {
        return next(new AppError('You are not authorized to view this project’s deadlines', 403));
      }
      const batchValues = getBatchLookupValues([project.batch, project.deadline?.batch, project.cohortId]);
      if (!batchValues.length) return next(new AppError('Project cohort batch is not configured. Contact an administrator.', 400));
      query.batch = { $in: batchValues };
    } else if (req.user && req.user.role !== 'admin' && req.user.batch) {
      query.batch = { $in: getBatchLookupValues(req.user.batch) };
    }

    const deadlines = await Deadline.find(query).sort({ submissionEndDate: 1 });
    res.status(200).json({
      status: 'success',
      deadlines,
    });
  } catch (error) {
    next(error);
  }
};

// Get all student users (for team member reference)
const getStudents = async (req, res, next) => {
  try {
    const searchTerm = (req.query.q || '').trim();
    const query = { role: 'student' };

    if (searchTerm) {
      const safeTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: safeTerm, $options: 'i' } },
        { email: { $regex: safeTerm, $options: 'i' } },
        { rollNumber: { $regex: safeTerm, $options: 'i' } },
      ];
    }

    const students = await User.find(query)
      .select('name email rollNumber department')
      .sort({ name: 1 });

    res.status(200).json({
      status: 'success',
      users: students,
    });
  } catch (error) {
    next(error);
  }
};

const getProjectFacultyRecommendations = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('leader', 'name department section batch');

    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    if (!isAssignmentEligible(project)) {
      return next(new AppError('This project is not ready for faculty assignment or reassignment', 400));
    }

    const facultyUsers = await User.find({
      role: 'faculty',
      isActive: { $ne: false },
    }).sort({ name: 1 });

    const facultyLoads = facultyUsers.length
      ? await Project.aggregate([
        { $match: { assignedFaculty: { $in: facultyUsers.map((faculty) => faculty._id) } } },
        { $group: { _id: '$assignedFaculty', count: { $sum: 1 } } },
      ])
      : [];
    const loadByFacultyId = new Map(facultyLoads.map(({ _id, count }) => [String(_id), count]));
    const facultyWithLoads = facultyUsers.map((faculty) => ({
      ...(typeof faculty.toObject === 'function' ? faculty.toObject() : faculty),
      assignedProjectCount: loadByFacultyId.get(String(faculty._id)) || 0,
    }));
    const recommendations = getFacultyRecommendationsForProject(project, facultyWithLoads);

    res.status(200).json({
      status: 'success',
      data: recommendations,
    });
  } catch (error) {
    next(error);
  }
};

const assignFacultyToProject = async (req, res, next) => {
  try {
    const { facultyId } = req.body;

    if (!facultyId) {
      return next(new AppError('facultyId is required', 400));
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }
    if (!isAssignmentEligible(project)) {
      return next(new AppError('This project is not ready for faculty assignment or reassignment', 400));
    }

    const faculty = await User.findById(facultyId);
    if (!faculty || faculty.role !== 'faculty') {
      return next(new AppError('Invalid faculty account ID', 400));
    }

    if (faculty.isActive === false) {
      return next(new AppError('This faculty member is inactive and cannot be assigned', 400));
    }

    const availabilityStatus = faculty.availability || faculty.facultyProfile?.availability || 'available';
    if (availabilityStatus === 'unavailable') {
      return next(new AppError('This faculty member is marked unavailable', 400));
    }

    if (String(project.assignedFaculty || '') === String(faculty._id)) {
      await notifyProjectTeamOfFacultyAssignment(project, faculty, project.assignedFaculty);
      const populated = await populateAssignedProject(project._id);
      return res.status(200).json({
        status: 'success',
        message: 'This faculty member is already assigned to the project',
        project: populated,
      });
    }

    const currentLoad = await Project.countDocuments({ assignedFaculty: faculty._id });
    const maxProjects = Number(faculty.facultyProfile?.maxProjects || faculty.maxProjects || 6);
    if (currentLoad >= maxProjects) {
      return next(new AppError('This faculty member has reached maximum project capacity', 400));
    }

    const facultyForRecommendation = {
      ...(typeof faculty.toObject === 'function' ? faculty.toObject() : faculty),
      assignedProjectCount: currentLoad,
    };
    const recommendations = getFacultyRecommendationsForProject(project, [facultyForRecommendation]);
    if (!recommendations.length) {
      return next(new AppError('This faculty member is not a valid project guide for the current project', 400));
    }

    const previousFacultyId = project.assignedFaculty;
    project.assignedFaculty = faculty._id;
    project.status = 'faculty_review';
    project.facultyAssignedAt = new Date();
    project.facultyAssignedBy = req.user.id;
    await project.save();

    await notifyProjectTeamOfFacultyAssignment(project, faculty, previousFacultyId);

    const leader = await User.findById(project.leader);
    await sendFacultyAssignmentEmail({
      recipientEmail: faculty.email,
      facultyName: faculty.name,
      projectTitle: project.title,
      teamLeaderName: leader ? leader.name : 'Project Team Leader',
      department: project.department || leader?.department || faculty.department,
      section: project.section || leader?.section || 'Not specified',
    });

    const populated = await populateAssignedProject(project._id);

    res.status(200).json({
      status: 'success',
      message: 'Faculty assigned successfully',
      project: populated,
      recommendation: recommendations[0],
    });
  } catch (error) {
    next(error);
  }
};

// Assign reviewer (Admin only)
const assignReviewer = async (req, res, next) => {
  const { projectId, facultyId } = req.body;
  if (!projectId || !facultyId) {
    return next(new AppError('projectId and facultyId are required', 400));
  }
  return assignFacultyToProject({
    ...req,
    params: { ...req.params, id: projectId },
    body: { ...req.body, facultyId },
  }, res, next);
};

module.exports = {
  getUploadUrl,
  createProject,
  submitProject,
  withdrawProject,
  getStudentDeadlines,
  getProjects,
  getProjectById,
  updateProject,
  uploadProjectFile,
  downloadProjectFile,
  buildReportOriginalityResult,
  getStudents,
  assignReviewer,
  runUniquenessCheck,
  submitProposalForReview,
  getFacultyReviewProjects,
  getProposalReviewProjects,
  uploadStageFile,
  saveStageDraft,
  submitStage,
  reviewStageSubmission,
  grantStageRevisionAccess,
  reviewProject,
  getProjectFacultyRecommendations,
  assignFacultyToProject,
  getProjectMessages,
  createProjectMessage,
  requestRevision,
  grantRevisionAccess,
  requestRevisionAccess,
  respondToRevisionAccessRequest,
  resubmitProject,
};