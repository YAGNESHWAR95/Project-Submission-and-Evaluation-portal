const mongoose = require('mongoose');

const StageSubmissionFilesSchema = new mongoose.Schema({
  reportUrl: { type: String, default: '' },
  reportHash: { type: String, default: '' },
  reportName: { type: String, default: '' },
  reportStorageName: { type: String, default: '' },
  reportText: { type: String, default: '' },
  reportTextStatus: { type: String, enum: ['available', 'needs_ocr'], default: 'needs_ocr' },
  reportPageCount: { type: Number, default: 0 },
  reportPagesAnalyzed: { type: Number, default: 0 },
  reportAnalysisVersion: { type: Number, default: 0 },
  reportAnalyzedAt: Date,
  pptUrl: { type: String, default: '' },
  pptHash: { type: String, default: '' },
  pptName: { type: String, default: '' },
  pptStorageName: { type: String, default: '' },
  codeZipUrl: { type: String, default: '' },
  codeZipHash: { type: String, default: '' },
  codeZipName: { type: String, default: '' },
  codeZipStorageName: { type: String, default: '' },
}, { _id: false });

const StageSubmissionSchema = new mongoose.Schema({
  phase: { type: String, enum: ['abstract', 'midterm', 'final'], required: true },
  version: { type: Number, required: true, min: 1 },
  resubmissionOfVersion: { type: Number },
  deploymentUrl: { type: String, trim: true, maxlength: 2048 },
  draftSavedAt: Date,
  files: { type: StageSubmissionFilesSchema, default: () => ({}) },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'resubmitted', 'approved', 'changes_requested'],
    default: 'draft',
  },
  submittedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewDecision: { type: String, enum: ['approved', 'changes_requested'] },
  feedback: { type: String, trim: true, maxlength: 2000 },
  revisionAccessGranted: { type: Boolean, default: false },
  revisionFileTypes: [{ type: String, enum: ['report', 'presentation', 'source', 'deploymentUrl'] }],
  revisionDueDate: Date,
  revisionGrantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revisionGrantedAt: Date,
  reportOriginality: { type: mongoose.Schema.Types.Mixed, default: null },
  rubricEvaluation: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

const ProjectSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Project title is required'],
    trim: true,
    maxlength: [200, 'Project title cannot exceed 200 characters'],
  },
  projectType: {
    type: String,
    enum: ['mini_project', 'major_project', 'other'],
    default: 'major_project',
  },
  academicYear: { type: String, trim: true, maxlength: 20 },
  semester: { type: String, trim: true, maxlength: 40 },
  batch: { type: String, trim: true, maxlength: 80 },
  section: { type: String, trim: true, maxlength: 40 },
  cohortId: { type: String, trim: true, index: true },
  abstract: { type: String, trim: true, maxlength: 3000 },
  problemStatement: { type: String, trim: true, maxlength: 5000 },
  objectives: { type: String, trim: true, maxlength: 5000 },
  proposedSolution: { type: String, trim: true, maxlength: 5000 },
  methodology: { type: String, trim: true, maxlength: 5000 },
  expectedOutcome: { type: String, trim: true, maxlength: 5000 },
  technologies: { type: String, trim: true, maxlength: 1000 },
  domain: { type: String, trim: true, maxlength: 120 },
  keywords: { type: String, trim: true, maxlength: 500 },
  description: {
    type: String,
    required: [true, 'Project description is required'],
    maxlength: 5000,
  },
  leader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Project leader is required'],
    index: true,
  },
  teamMembers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  assignedFaculty: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  facultyAssignedAt: {
    type: Date,
  },
  facultyAssignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  deadline: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deadline',
  },
  status: {
    type: String,
    enum: [
      'proposal_created',
      'draft',
      'uniqueness_checked',
      'faculty_review',
      'faculty_accepted',
      'faculty_changes_requested',
      'submitted',
      'under_review',
      'revision_required',
      'resubmitted',
      'evaluated',
      'approved',
      'rejected',
      'withdrawn',
    ],
    default: 'proposal_created',
  },
  stageWorkflowEnabled: { type: Boolean, default: false },
  uniquenessCheck: {
    status: {
      type: String,
      enum: ['not_checked', 'checking', 'completed', 'failed', 'insufficient_text'],
      default: 'not_checked',
    },
    checkedAt: Date,
    algorithm: { type: String, default: 'TF-IDF + Cosine Similarity' },
    overallScore: { type: Number, default: 0 },
    semanticStatus: { type: String, enum: ['available', 'partial', 'unavailable', 'not_attempted'] },
    scoreMethod: { type: String, trim: true },
    result: {
      type: String,
      enum: ['likely_unique', 'needs_attention', 'high_similarity', 'insufficient_text'],
      default: 'likely_unique',
    },
    matches: [{
      projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
      title: { type: String, trim: true },
      domain: { type: String, trim: true },
      similarityScore: Number,
      textSimilarity: Number,
      semanticSimilarity: Number,
      scoreBreakdown: {
        textSimilarity: Number,
        semanticSimilarity: Number,
        combinedSimilarity: Number,
        textWeight: Number,
        semanticWeight: Number,
      },
      semanticStatus: { type: String, enum: ['available', 'unavailable'] },
      semanticReason: { type: String, trim: true },
      sectionComparisons: [{
        field: { type: String, trim: true },
        label: { type: String, trim: true },
        currentTextAvailable: Boolean,
        matchedTextAvailable: Boolean,
        comparable: Boolean,
        similarityScore: Number,
        matchingTerms: [{ type: String, trim: true }],
        explanation: { type: String, trim: true },
      }],
      sharedSignals: [{ type: String, trim: true }],
      evidence: { type: String, trim: true },
      explanation: { type: String, trim: true },
    }],
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: Date,
  reviewDecision: {
    type: String,
    enum: ['accepted', 'changes_requested', 'rejected'],
  },
  deploymentUrl: { type: String, trim: true, maxlength: 2048 },
  facultyComment: {
    type: String,
    trim: true,
    maxlength: 2000,
  },
  revisionRequest: {
    active: { type: Boolean, default: false },
    phase: { type: String, enum: ['proposal', 'project'], default: 'project' },
    status: {
      type: String,
      enum: ['pending', 'granted', 'resolved', 'rejected'],
      default: 'pending',
    },
    reason: { type: String, trim: true, maxlength: 2000 },
    feedback: { type: String, trim: true, maxlength: 2000 },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    requestedAt: Date,
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    grantedAt: Date,
    dueDate: Date,
    editableFields: [{ type: String }],
    fileTypes: [{ type: String, enum: ['report', 'presentation', 'source'] }],
    snapshotBeforeRevision: { type: mongoose.Schema.Types.Mixed },
  },
  revisionAccessRequest: {
    status: { type: String, enum: ['none', 'pending', 'granted', 'denied'], default: 'none' },
    reason: { type: String, trim: true, maxlength: 2000 },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    editableFields: [{ type: String }],
    fileTypes: [{ type: String, enum: ['report', 'presentation', 'source'] }],
    revisionDeadline: Date,
  },
  revisionHistory: [{
    versionNumber: Number,
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    submittedAt: Date,
    summary: String,
    fieldsChanged: [String],
    snapshot: { type: mongoose.Schema.Types.Mixed },
    reviewOutcome: {
      type: String,
      enum: ['pending', 'approved', 'changes_requested'],
      default: 'pending',
    },
  }],
  files: {
    reportUrl: { type: String, default: '' },
    reportHash: { type: String, default: '' },
    reportName: { type: String, default: '' },
    reportStorageName: { type: String, default: '' },
    reportText: { type: String, default: '' },
    reportTextStatus: { type: String, enum: ['available', 'needs_ocr'], default: 'needs_ocr' },
    reportPageCount: { type: Number, default: 0 },
    reportPagesAnalyzed: { type: Number, default: 0 },
    reportAnalysisVersion: { type: Number, default: 0 },
    reportAnalyzedAt: { type: Date },
    pptUrl: { type: String, default: '' },
    pptHash: { type: String, default: '' },
    pptName: { type: String, default: '' },
    pptStorageName: { type: String, default: '' },
    codeZipUrl: { type: String, default: '' },
    codeZipHash: { type: String, default: '' },
    codeZipName: { type: String, default: '' },
    codeZipStorageName: { type: String, default: '' },
  },
  stageSubmissions: { type: [StageSubmissionSchema], default: [] },
  reportOriginality: { type: mongoose.Schema.Types.Mixed, default: null },
  plagiarismScore: {
    type: Number,
    default: 0,
  },
  plagiarismResult: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlagiarismResult',
  },
  evaluation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Evaluation',
  },
  submittedAt: {
    type: Date,
  },
  cohort: {
    type: String,
    trim: true,
  },
  department: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for members pointing to teamMembers
ProjectSchema.virtual('members').get(function () {
  return this.teamMembers;
});

// Index for leader project lookup
ProjectSchema.index({ leader: 1, deadline: 1 }, { unique: true });

// Index for faculty project lookup
ProjectSchema.index({ assignedFaculty: 1, status: 1 });

module.exports = mongoose.model('Project', ProjectSchema);
