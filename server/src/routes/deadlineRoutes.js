const express = require('express');
const { createDeadline, updateDeadline, getDeadlines, getBatchDeadline } = require('../controllers/deadlineController');
const { protect } = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { validateBody } = require('../middleware/validateRequest');

const router = express.Router();

router.use(protect); // All deadline endpoints require login

router.post('/', restrictTo('admin'), validateBody(['batch', 'title', 'submissionStartDate', 'submissionEndDate']), createDeadline);
router.patch('/:id', restrictTo('admin'), updateDeadline);
router.get('/', getDeadlines);
router.get('/batch/:batch', getBatchDeadline);

module.exports = router;
