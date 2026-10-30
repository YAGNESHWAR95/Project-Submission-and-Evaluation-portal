const mongoose = require('mongoose');
const crypto = require('crypto');

const TeamInvitationSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: [true, 'Project reference is required'],
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Inviter reference is required'],
  },
  invitedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Invited user reference is required'],
  },
  email: {
    type: String,
    required: [true, 'Invitee email is required'],
    lowercase: true,
    trim: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending',
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  acceptedAt: {
    type: Date,
  },
  rejectedAt: {
    type: Date,
  },
  emailStatus: {
    type: String,
    enum: ['pending', 'accepted_by_resend', 'failed', 'skipped'],
  },
  emailResendId: {
    type: String,
  },
  acceptedEmailStatus: {
    type: String,
    enum: ['pending', 'accepted_by_resend', 'failed', 'skipped'],
  },
  acceptedEmailResendId: {
    type: String,
  },
  rejectedEmailStatus: {
    type: String,
    enum: ['pending', 'accepted_by_resend', 'failed', 'skipped'],
  },
  rejectedEmailResendId: {
    type: String,
  },
}, {
  timestamps: true,
});

// Prevent duplicate active invitations for same project + user
TeamInvitationSchema.index({ project: 1, invitedUser: 1, status: 1 });

// Generate a secure invitation token
TeamInvitationSchema.statics.generateToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = mongoose.model('TeamInvitation', TeamInvitationSchema);
