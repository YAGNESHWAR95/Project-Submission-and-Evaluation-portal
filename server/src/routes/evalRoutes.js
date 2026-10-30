const express = require('express');
const { submitEvaluation, getAllEvaluations, getEvaluationsByProject } = require('../controllers/evalController');
const { protect } = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', getAllEvaluations);
router.post('/', restrictTo('faculty', 'admin'), submitEvaluation);
router.get('/project/:projectId', getEvaluationsByProject);

module.exports = router;
