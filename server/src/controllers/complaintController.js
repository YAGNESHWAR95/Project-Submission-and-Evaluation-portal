const Complaint = require('../models/Complaint');
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');

// Create complaint (student only)
const createComplaint = async (req, res, next) => {
  try {
    const { projectId, subject, description } = req.body;

    if (!projectId || !subject || !description) {
      return next(new AppError('projectId, subject, and description are required', 400));
    }

    // Verify project exists and user is a team member
    const project = await Project.findById(projectId);
    if (!project) {
      return next(new AppError('Project not found', 404));
    }

    if (!project.teamMembers.some(m => m.toString() === req.user.id)) {
      return next(new AppError('You can only create complaints for your own projects', 403));
    }

    const complaint = await Complaint.create({
      project: projectId,
      user: req.user.id,
      subject,
      description,
      status: 'open',
    });

    await complaint.populate('project', 'title status');

    res.status(201).json({
      status: 'success',
      complaint,
    });
  } catch (error) {
    next(error);
  }
};

// Get my complaints (student)
const getMyComplaints = async (req, res, next) => {
  try {
    const complaints = await Complaint.find({ user: req.user.id })
      .populate('project', 'title status')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      complaints,
    });
  } catch (error) {
    next(error);
  }
};

// Get all complaints (admin only)
const getAllComplaints = async (req, res, next) => {
  try {
    const complaints = await Complaint.find()
      .populate('project', 'title status')
      .populate('user', 'name email rollNumber department')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      complaints,
    });
  } catch (error) {
    next(error);
  }
};

// Update complaint status (admin only)
const updateComplaintStatus = async (req, res, next) => {
  try {
    const { status, adminResponse } = req.body;

    if (!status || !['open', 'in_review', 'resolved'].includes(status)) {
      return next(new AppError('Valid status is required (open, in_review, resolved)', 400));
    }

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return next(new AppError('Complaint not found', 404));
    }

    complaint.status = status;
    if (adminResponse) complaint.adminResponse = adminResponse;
    await complaint.save();

    // Notify the student
    await Notification.create({
      recipient: complaint.user,
      type: 'complaint_status',
      title: 'Complaint Status Updated',
      message: `Your complaint "${complaint.subject}" status has been updated to: ${status.replace('_', ' ').toUpperCase()}.`,
      relatedProject: complaint.project,
    });

    await complaint.populate('project', 'title status');
    await complaint.populate('user', 'name email');

    res.status(200).json({
      status: 'success',
      complaint,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createComplaint,
  getMyComplaints,
  getAllComplaints,
  updateComplaintStatus,
};
