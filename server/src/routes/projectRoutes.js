const express = require('express');
const {
  getUploadUrl,
  createProject,
  submitProject,
  withdrawProject,
  getStudentDeadlines,
  getProjects,
  getProjectById,
  updateProject,
  uploadProjectFile,
  downloadProjectFile,
  getStudents,
  assignReviewer,
  runUniquenessCheck,
  submitProposalForReview,
  getFacultyReviewProjects,
  getProposalReviewProjects,
  uploadStageFile,
  saveStageDraft,
  submitStage,
  reviewStageSubmission,
  grantStageRevisionAccess,
  reviewProject,
  getProjectFacultyRecommendations,
  assignFacultyToProject,
  getProjectMessages,
  createProjectMessage,
  requestRevision,
  grantRevisionAccess,
  requestRevisionAccess,
  respondToRevisionAccessRequest,
  resubmitProject,
  
} = require('../controllers/projectController');
const { protect } = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');


const router = express.Router();

// Authenticated routes
router.use(protect);

router.get('/upload-url', getUploadUrl);
router.get('/students', getStudents);
router.get('/deadlines', getStudentDeadlines);
router.get('/my', getProjects);
router.get('/faculty-review', restrictTo('faculty', 'admin'), getFacultyReviewProjects);
router.get('/proposal-review', restrictTo('faculty', 'admin'), getProposalReviewProjects);

// Project creation (DRAFT)
router.post('/', restrictTo('student'), createProject);

// Backward-compatible single-step submit
router.post('/submit', restrictTo('student'), submitProject);

// Admin reviewer assignment
router.post('/assign-reviewer', restrictTo('admin'), assignReviewer);
router.get('/:id/faculty-recommendations', restrictTo('admin'), getProjectFacultyRecommendations);
router.post('/:id/assign-faculty', restrictTo('admin'), assignFacultyToProject);

// Specific project routes
router.get('/:id', getProjectById);
router.get('/:id/messages', restrictTo('student', 'faculty', 'admin'), getProjectMessages);
router.post('/:id/messages', restrictTo('student', 'faculty', 'admin'), createProjectMessage);
router.post('/:id/request-revision', restrictTo('faculty', 'admin'), requestRevision);
router.post('/:id/grant-revision-access', restrictTo('faculty', 'admin'), grantRevisionAccess);
router.post('/:id/revision-access-request', restrictTo('student'), requestRevisionAccess);
router.post('/:id/revision-access-request/respond', restrictTo('faculty', 'admin'), respondToRevisionAccessRequest);
router.post('/:id/resubmit', restrictTo('student'), resubmitProject);
router.post('/:id/submit-proposal', restrictTo('student'), submitProposalForReview);
router.post('/:id/stages/:phase/files', restrictTo('student'), upload.single('file'), uploadStageFile);
router.post('/:id/stages/:phase/save', restrictTo('student'), saveStageDraft);
router.post('/:id/stages/:phase/submit', restrictTo('student'), submitStage);
router.post('/:id/stages/:phase/versions/:version/review', restrictTo('faculty', 'admin'), reviewStageSubmission);
router.post('/:id/stages/:phase/versions/:version/grant-revision', restrictTo('faculty', 'admin'), grantStageRevisionAccess);
router.post('/:id/uniqueness-check', restrictTo('student'), runUniquenessCheck);
router.post('/:id/review', restrictTo('faculty', 'admin'), reviewProject);
router.put('/:id', restrictTo('student'), updateProject);
router.post('/:id/files', restrictTo('student'), upload.single('file'), uploadProjectFile);
router.get('/:id/files/:purpose/download', restrictTo('student', 'faculty', 'admin'), downloadProjectFile);
router.post('/:id/submit', restrictTo('student'), submitProject);
router.post('/:id/withdraw', restrictTo('student'), withdrawProject);

// List projects
router.get('/', getProjects);

module.exports = router;
