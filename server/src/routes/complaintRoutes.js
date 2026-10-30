const express = require('express');
const {
  createComplaint,
  getMyComplaints,
  getAllComplaints,
  updateComplaintStatus,
} = require('../controllers/complaintController');
const { protect } = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect);

router.post('/', restrictTo('student'), createComplaint);
router.get('/my', restrictTo('student'), getMyComplaints);
router.get('/', restrictTo('admin', 'faculty'), getAllComplaints);
router.patch('/:id/status', restrictTo('admin'), updateComplaintStatus);

module.exports = router;
