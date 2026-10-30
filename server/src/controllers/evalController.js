const Evaluation = require('../models/Evaluation');
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { sendEmailAlert } = require('../services/notificationService');

const PHASE_RUBRICS = {
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

// Submit / Update evaluation for a project phase
const submitEvaluation = async (req, res, next) => {
  try {
    const { projectId, phase, scores, feedback, isPublished } = req.body;
    const evaluatorId = req.user.id;

    if (!projectId || !phase || !scores || !scores.length) {
      return next(new AppError('Missing required evaluation data', 400));
    }

    if (!['abstract', 'midterm', 'final'].includes(phase)) {
      return next(new AppError('Invalid evaluation phase milestone', 400));
    }

    const expectedCriteria = PHASE_RUBRICS[phase];
    const receivedCriteria = new Set();
    if (scores.length !== expectedCriteria.length || scores.some((score) => {
      const expected = expectedCriteria.find((criterion) => criterion.name === score.criteriaName);
      const scoredMarks = Number(score.scoredMarks);
      const valid = Boolean(expected)
        && !receivedCriteria.has(score.criteriaName)
        && Number(score.maxMarks) === expected.maxMarks
        && Number.isFinite(scoredMarks)
        && scoredMarks >= 0
        && scoredMarks <= expected.maxMarks;
      receivedCriteria.add(score.criteriaName);
      return !valid;
    })) {
      return next(new AppError('Scores must match the phase rubric and stay within each category maximum', 400));
    }

    // Verify Project
    const project = await Project.findById(projectId).populate('teamMembers', 'name email');
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    // Faculty check - must be assigned to this project, or be an admin
    if (req.user.role === 'faculty' && String(project.assignedFaculty?._id || project.assignedFaculty || '') !== String(evaluatorId)) {
      return next(new AppError('You are not authorized to grade this project', 403));
    }

    const phaseSubmissions = (project.stageSubmissions || [])
      .filter((submission) => submission.phase === phase && ['submitted', 'resubmitted', 'approved'].includes(submission.status))
      .sort((left, right) => Number(right.version) - Number(left.version));
    const stageSubmission = phaseSubmissions[0] || null;
    const legacyFinalSubmission = phase === 'final'
      && !project.stageWorkflowEnabled
      && ['submitted', 'under_review', 'evaluated'].includes(project.status)
      && project.files?.reportUrl
      && project.files?.pptUrl
      && project.files?.codeZipUrl;
    if (!stageSubmission && !legacyFinalSubmission) {
      return next(new AppError(`A submitted ${phase.toUpperCase()} stage version is required before grading`, 400));
    }
    const submissionVersion = Number(req.body.submissionVersion ?? stageSubmission?.version ?? 0);
    if (stageSubmission && submissionVersion !== Number(stageSubmission.version)) {
      return next(new AppError('The selected evaluation version is no longer the latest submitted phase version', 409));
    }

    // Server-side dynamic calculation of total score
    let calculatedTotal = 0;
    scores.forEach(s => {
      calculatedTotal += Number(s.scoredMarks);
    });

    // Check if evaluation already exists for this project + phase (Milestone Lock)
    let evaluation = await Evaluation.findOne({ projectId, phase });

    if (evaluation) {
      if (Number(evaluation.submissionVersion || 0) !== submissionVersion) {
        const previousStageSubmission = (project.stageSubmissions || []).find((submission) => (
          submission.phase === phase && Number(submission.version) === Number(evaluation.submissionVersion || 0)
        ));
        if (previousStageSubmission && !previousStageSubmission.rubricEvaluation) {
          previousStageSubmission.rubricEvaluation = {
            evaluatorId: evaluation.evaluatorId,
            scores: evaluation.scores,
            totalScore: evaluation.totalScore,
            feedback: evaluation.feedback,
            isPublished: evaluation.isPublished,
            evaluatedAt: evaluation.evaluatedAt,
          };
          await project.save();
        }
      }
      // Update existing record
      evaluation.evaluatorId = evaluatorId;
      evaluation.submissionVersion = submissionVersion;
      evaluation.scores = scores;
      evaluation.totalScore = calculatedTotal;
      evaluation.feedback = feedback || '';
      evaluation.isPublished = isPublished !== undefined ? isPublished : evaluation.isPublished;
      evaluation.evaluatedAt = Date.now();
      await evaluation.save();
    } else {
      // Create new evaluation
      evaluation = await Evaluation.create({
        projectId,
        evaluatorId,
        phase,
        submissionVersion,
        scores,
        totalScore: calculatedTotal,
        feedback: feedback || '',
        isPublished: isPublished !== undefined ? isPublished : false,
      });
    }

    if (stageSubmission) {
      stageSubmission.rubricEvaluation = {
        evaluatorId,
        submissionVersion,
        scores,
        totalScore: calculatedTotal,
        feedback: feedback || '',
        isPublished: Boolean(isPublished),
        evaluatedAt: evaluation.evaluatedAt,
      };
      await project.save();
    }

    // Update project overall status if phase is final and published
    if (isPublished) {
      if (phase === 'final') {
        project.evaluation = evaluation._id;
        if (!stageSubmission) project.status = 'evaluated';
        await project.save();
      }

      // Create in-app notifications for team members
      for (const member of project.teamMembers) {
        await Notification.create({
          recipient: member._id || member,
          type: 'evaluation_published',
          title: `Evaluation Published: ${phase.toUpperCase()} Phase`,
          message: `Your evaluation results for "${project.title}" (${phase} phase) have been published. Total Score: ${calculatedTotal}`,
          relatedProject: project._id,
        });
      }

      // Trigger Alert Notification to team members
      const teamEmails = project.teamMembers.map(m => m.email).filter(Boolean);
      if (teamEmails.length > 0) {
        await sendEmailAlert(
          teamEmails.join(','),
          `New Evaluation Published: ${phase.toUpperCase()} Phase`,
          `Your evaluation results for phase "${phase.toUpperCase()}" have been published by the reviewer. Total Score: ${calculatedTotal}`,
          `<p>Your evaluation for <b>${project.title}</b> (${phase}) has been released.</p><b>Total Score: ${calculatedTotal}</b>`
        );
      }
    }

    res.status(200).json({
      status: 'success',
      evaluation,
    });
  } catch (error) {
    next(error);
  }
};

// List evaluations visible to the current user
const getAllEvaluations = async (req, res, next) => {
  try {
    let query = {};

    if (req.user.role === 'student') {
      const studentProjectIds = await Project.find({ teamMembers: req.user.id }).distinct('_id');
      query.projectId = { $in: studentProjectIds };
      query.isPublished = true;
    } else if (req.user.role === 'faculty') {
      const facultyProjectIds = await Project.find({ assignedFaculty: req.user.id }).distinct('_id');
      query.projectId = { $in: facultyProjectIds };
    }

    const evaluations = await Evaluation.find(query)
      .populate({ path: 'projectId', select: 'title teamMembers assignedFaculty status' })
      .populate('evaluatorId', 'name email department')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      status: 'success',
      evaluations,
    });
  } catch (error) {
    next(error);
  }
};

// Query evaluations by Project
const getEvaluationsByProject = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    // RBAC: Students can only view their own projects' evaluations, faculty/admin can view all
    if (req.user.role === 'student' && !project.teamMembers.some(m => m.toString() === req.user.id)) {
      return next(new AppError('You are not authorized to view these evaluations', 403));
    }
    if (req.user.role === 'faculty'
      && String(project.assignedFaculty?._id || project.assignedFaculty || '') !== String(req.user.id)) {
      return next(new AppError('You are not authorized to view these evaluations', 403));
    }

    const query = { projectId };
    // Students only view published marks
    if (req.user.role === 'student') {
      query.isPublished = true;
    }

    const evaluations = await Evaluation.find(query)
      .populate('evaluatorId', 'name email department')
      .sort({ phase: 1 });

    res.status(200).json({
      status: 'success',
      evaluations,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitEvaluation,
  getAllEvaluations,
  getEvaluationsByProject,
};
