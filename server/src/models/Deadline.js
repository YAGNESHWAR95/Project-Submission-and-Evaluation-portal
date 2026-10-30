const mongoose = require('mongoose');

const DeadlineSchema = new mongoose.Schema({
  batch: {
    type: String,
    required: [true, 'Batch is required (e.g. Batch 2026)'],
    trim: true,
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
  },
  phase: {
    type: String,
    enum: ['abstract', 'midterm', 'final'],
    default: 'final',
  },
  submissionStartDate: {
    type: Date,
    required: [true, 'Start date is required'],
  },
  submissionEndDate: {
    type: Date,
    required: [true, 'End date is required'],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Index to quickly fetch active deadline for a batch
DeadlineSchema.index({ batch: 1, phase: 1, isActive: 1 });

module.exports = mongoose.model('Deadline', DeadlineSchema);
