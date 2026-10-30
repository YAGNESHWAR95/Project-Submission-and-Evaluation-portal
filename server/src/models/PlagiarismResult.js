const mongoose = require('mongoose');

const PlagiarismResultSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: [true, 'Project reference is required'],
    index: true,
  },
  comparedProject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
  },
  similarityScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  similarityLevel: {
    type: String,
    enum: ['low', 'moderate', 'high', 'critical'],
    default: 'low',
  },
  matchingSections: [{
    fileType: String,
    detail: String,
  }],
  checkedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['completed', 'failed', 'pending'],
    default: 'completed',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('PlagiarismResult', PlagiarismResultSchema);
