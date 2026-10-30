const mongoose = require('mongoose');

const ProjectMemberSchema = new mongoose.Schema({
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
  role: {
    type: String,
    enum: ['leader', 'member'],
    required: [true, 'Member role is required'],
  },
  invitationStatus: {
    type: String,
    enum: ['accepted'],
    default: 'accepted',
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Unique: one user can only be a member of a project once
ProjectMemberSchema.index({ project: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('ProjectMember', ProjectMemberSchema);
