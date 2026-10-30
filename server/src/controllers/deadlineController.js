const Deadline = require('../models/Deadline');
const AppError = require('../utils/AppError');

const validateDeadlineFields = ({ batch, title, submissionStartDate, submissionEndDate, phase = 'final' }) => {
  if (typeof batch !== 'string' || !batch.trim() || typeof title !== 'string' || !title.trim()) {
    return 'Batch and title are required';
  }
  if (!['abstract', 'midterm', 'final'].includes(phase)) return 'Phase must be abstract, midterm, or final';
  const startDate = new Date(submissionStartDate);
  const endDate = new Date(submissionEndDate);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return 'Provide valid submission start and cutoff dates';
  }
  if (startDate >= endDate) {
    return 'Start date must be before end date';
  }
  return null;
};

// Create a new deadline (Admin only)
const createDeadline = async (req, res, next) => {
  try {
    const { batch, title, phase = 'final', submissionStartDate, submissionEndDate } = req.body;

    const validationError = validateDeadlineFields({ batch, title, phase, submissionStartDate, submissionEndDate });
    if (validationError) {
      return next(new AppError(validationError, 400));
    }

    await Deadline.updateMany({ batch, phase }, { isActive: false });

    const deadline = await Deadline.create({
      batch,
      title,
      phase,
      submissionStartDate,
      submissionEndDate,
      isActive: true,
    });

    res.status(201).json({
      status: 'success',
      deadline,
    });
  } catch (error) {
    next(error);
  }
};

const updateDeadline = async (req, res, next) => {
  try {
    const deadline = await Deadline.findById(req.params.id);
    if (!deadline) {
      return next(new AppError('Deadline not found', 404));
    }

    const nextDeadline = {
      batch: req.body.batch === undefined ? deadline.batch : req.body.batch?.trim(),
      title: req.body.title === undefined ? deadline.title : req.body.title?.trim(),
      phase: req.body.phase === undefined ? deadline.phase || 'final' : req.body.phase,
      submissionStartDate: req.body.submissionStartDate === undefined ? deadline.submissionStartDate : req.body.submissionStartDate,
      submissionEndDate: req.body.submissionEndDate === undefined ? deadline.submissionEndDate : req.body.submissionEndDate,
    };
    const validationError = validateDeadlineFields(nextDeadline);
    if (validationError) {
      return next(new AppError(validationError, 400));
    }

    if (req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') {
      return next(new AppError('isActive must be a boolean', 400));
    }
    const isActive = typeof req.body.isActive === 'boolean' ? req.body.isActive : deadline.isActive;
    const reopening = isActive && !deadline.isActive;
    if (reopening && new Date(nextDeadline.submissionEndDate) <= new Date()) {
      return next(new AppError('Reschedule the cutoff to a future date before reopening this deadline', 400));
    }

    deadline.batch = nextDeadline.batch;
    deadline.title = nextDeadline.title;
    deadline.phase = nextDeadline.phase;
    deadline.submissionStartDate = nextDeadline.submissionStartDate;
    deadline.submissionEndDate = nextDeadline.submissionEndDate;
    deadline.isActive = isActive;
    await deadline.save();

    if (isActive) {
      await Deadline.updateMany({ batch: deadline.batch, phase: deadline.phase, _id: { $ne: deadline._id } }, { isActive: false });
    }

    res.status(200).json({ status: 'success', deadline });
  } catch (error) {
    next(error);
  }
};

// Get all deadlines
const getDeadlines = async (req, res, next) => {
  try {
    const deadlines = await Deadline.find().sort({ createdAt: -1 });
    res.status(200).json({
      status: 'success',
      deadlines,
    });
  } catch (error) {
    next(error);
  }
};

// Get active deadline for a specific batch
const getBatchDeadline = async (req, res, next) => {
  try {
    const { batch } = req.params;
    const phase = req.query.phase || 'final';
    const deadline = await Deadline.findOne({ batch, phase, isActive: true });
    
    res.status(200).json({
      status: 'success',
      deadline,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDeadline,
  updateDeadline,
  getDeadlines,
  getBatchDeadline,
};
