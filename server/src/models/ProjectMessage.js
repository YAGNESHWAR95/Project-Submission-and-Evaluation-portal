const mongoose = require('mongoose');

const ProjectMessageSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: [true, 'Project reference is required'],
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender is required'],
    index: true,
  },
  content: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true,
    maxlength: [4000, 'Message cannot exceed 4000 characters'],
  },
  senderRole: {
    type: String,
    enum: ['student', 'faculty', 'admin'],
    default: 'student',
  },
  parentMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectMessage',
    default: null,
  },
  isSystem: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

ProjectMessageSchema.index({ project: 1, createdAt: -1 });

module.exports = mongoose.model('ProjectMessage', ProjectMessageSchema);
