const mongoose = require('mongoose');

const ScoreSchema = new mongoose.Schema({
  criteriaName: {
    type: String,
    required: true,
  },
  maxMarks: {
    type: Number,
    required: true,
  },
  scoredMarks: {
    type: Number,
    required: true,
    min: 0,
  },
});

const EvaluationSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: [true, 'Project ID is required'],
  },
  evaluatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Evaluator ID is required'],
  },
  phase: {
    type: String,
    enum: ['abstract', 'midterm', 'final'],
    required: [true, 'Evaluation phase is required'],
  },
  submissionVersion: { type: Number, default: 0, min: 0 },
  scores: [ScoreSchema],
  totalScore: {
    type: Number,
    required: true,
    default: 0,
  },
  feedback: {
    type: String,
    trim: true,
    default: '',
  },
  isPublished: {
    type: Boolean,
    default: false,
  },
  evaluatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Ensure a project can have only one evaluation record per milestone phase
EvaluationSchema.index({ projectId: 1, phase: 1 }, { unique: true });

// Index for evaluator queries
EvaluationSchema.index({ evaluatorId: 1 });

module.exports = mongoose.model('Evaluation', EvaluationSchema);
