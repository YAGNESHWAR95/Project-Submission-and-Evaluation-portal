const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { getCohortId } = require('../utils/cohort');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
  },
  officialCollegeEmail: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid official college email address when present'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long'],
    select: false, // Don't return password by default
  },
  role: {
    type: String,
    enum: ['student', 'faculty', 'admin'],
    required: [true, 'Role is required'],
  },
  department: {
    type: String,
    required: [true, 'Department is required'],
    trim: true,
  },
  rollNumber: {
    type: String,
    trim: true,
    sparse: true, // Allows multiple null values
  },
  section: {
    type: String,
    trim: true,
    uppercase: true,
  },
  batch: {
    type: String,
    trim: true,
    maxlength: 80,
  },
  academicYear: {
    type: String,
    trim: true,
    maxlength: 20,
  },
  cohortId: {
    type: String,
    trim: true,
    index: true,
  },
  facultyId: {
    type: String,
    trim: true,
    sparse: true,
  },
  availability: {
    type: String,
    enum: ['available', 'limited', 'unavailable'],
    default: 'available',
  },
  facultyProfile: {
    facultyId: {
      type: String,
      trim: true,
      sparse: true,
    },
    qualification: { type: String, trim: true },
    specialization: { type: String, trim: true },
    expertise: [{ type: String, trim: true }],
    subjects: [{ type: String, trim: true }],
    researchAreas: [{ type: String, trim: true }],
    experienceYears: { type: Number, default: 0 },
    maxProjects: { type: Number, default: 6 },
    currentProjects: { type: Number, default: 0 },
    availability: {
      type: String,
      enum: ['available', 'limited', 'unavailable'],
      default: 'available',
    },
  },
  avatar: {
    type: String,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

UserSchema.pre('validate', function() {
  this.cohortId = this.role === 'student'
    ? getCohortId(this)
    : undefined;
});

// Pre-save hook to hash password
UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
