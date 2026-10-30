export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const ROLES = {
  STUDENT: 'student',
  FACULTY: 'faculty',
  ADMIN: 'admin',
};

export const PROJECT_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  EVALUATED: 'evaluated',
};

export const EVALUATION_PHASES = {
  ABSTRACT: 'abstract',
  MIDTERM: 'midterm',
  FINAL: 'final',
};

export const PHASE_CRITERIA = {
  abstract: [
    { name: 'Novelty & Scope', maxMarks: 10 },
    { name: 'Literature Survey', maxMarks: 10 },
    { name: 'SRS Document Quality', maxMarks: 10 },
  ],
  midterm: [
    { name: 'Architecture Design', maxMarks: 10 },
    { name: 'Database Structure', maxMarks: 10 },
    { name: 'Component Integration', maxMarks: 20 },
  ],
  final: [
    { name: 'Source Code Quality', maxMarks: 20 },
    { name: 'Viva Voce / Q&A', maxMarks: 25 },
    { name: 'Project Presentation', maxMarks: 15 },
  ],
};
