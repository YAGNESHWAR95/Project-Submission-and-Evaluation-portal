const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: [true, 'Project reference is required'],
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required'],
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true,
    maxlength: [200, 'Subject cannot exceed 200 characters'],
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
  },
  status: {
    type: String,
    enum: ['open', 'in_review', 'resolved'],
    default: 'open',
  },
  adminResponse: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

// Index for user's complaints and status filtering
ComplaintSchema.index({ user: 1, status: 1 });
ComplaintSchema.index({ project: 1 });

module.exports = mongoose.model('Complaint', ComplaintSchema);
