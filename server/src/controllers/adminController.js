const User = require('../models/User');
const Project = require('../models/Project');
const Evaluation = require('../models/Evaluation');
const AppError = require('../utils/AppError');
const { exportEvaluationsToCSV } = require('../services/reportService');
const { getCohortId } = require('../utils/cohort');

const normalizeFacultyProfile = (payload = {}) => {
  const expertise = Array.isArray(payload.expertise)
    ? payload.expertise
    : typeof payload.expertise === 'string'
      ? payload.expertise.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

  const subjects = Array.isArray(payload.subjects)
    ? payload.subjects
    : typeof payload.subjects === 'string'
      ? payload.subjects.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

  const researchAreas = Array.isArray(payload.researchAreas)
    ? payload.researchAreas
    : typeof payload.researchAreas === 'string'
      ? payload.researchAreas.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

  return {
    facultyId: payload.facultyId || payload.facultyProfile?.facultyId || '',
    qualification: payload.qualification || payload.facultyProfile?.qualification || '',
    specialization: payload.specialization || payload.facultyProfile?.specialization || '',
    expertise,
    subjects,
    researchAreas,
    experienceYears: Number(payload.experienceYears || payload.facultyProfile?.experienceYears || 0),
    maxProjects: Number(payload.maxProjects || payload.facultyProfile?.maxProjects || 6),
    availability: payload.availability || payload.facultyProfile?.availability || 'available',
    currentProjects: Number(payload.currentProjects || payload.facultyProfile?.currentProjects || 0),
  };
};

// Get global system analytics
const getSystemStats = async (req, res, next) => {
  try {
    const [totalStudents, totalFaculty, statusCounts, deptStats, publishedEvals] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'faculty' }),
      Project.aggregate([{
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          assignedCount: {
            $sum: {
              $cond: [{ $ne: [{ $ifNull: ['$assignedFaculty', null] }, null] }, 1, 0],
            },
          },
        },
      }]),
      Project.aggregate([
        { $match: { status: { $nin: ['proposal_created', 'draft'] } } },
        {
          $lookup: {
            from: 'users',
            localField: 'leader',
            foreignField: '_id',
            as: 'leaderInfo',
          },
        },
        { $unwind: { path: '$leaderInfo', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ['$department', { $ifNull: ['$leaderInfo.department', 'Unspecified'] }] },
            submissions: { $sum: 1 },
          },
        },
        { $project: { _id: 0, department: '$_id', submissions: 1 } },
        { $sort: { submissions: -1 } },
      ]),
      Evaluation.find({ isPublished: true }),
    ]);

    const countsByStatus = new Map(statusCounts.map(({ _id, count, assignedCount }) => [
      _id,
      { count, assignedCount },
    ]));
    const getStatusCount = (statuses, key = 'count') => statuses.reduce(
      (total, status) => total + (countsByStatus.get(status)?.[key] || 0),
      0,
    );
    const totalProjects = statusCounts.reduce((total, status) => total + status.count, 0);
    const proposalCount = getStatusCount(['proposal_created', 'draft']);
    const assignmentReadyStatuses = ['uniqueness_checked', 'submitted'];
    const readyCount = getStatusCount(assignmentReadyStatuses);
    const readyAssignedCount = getStatusCount(assignmentReadyStatuses, 'assignedCount');
    const awaitingAssignmentCount = readyCount - readyAssignedCount;
    const reviewCount = getStatusCount([
      'faculty_review',
      'faculty_accepted',
      'faculty_changes_requested',
      'under_review',
      'revision_required',
      'resubmitted',
    ]) + readyAssignedCount;
    const evaluatedCount = getStatusCount(['evaluated', 'approved']);
    const closedCount = getStatusCount(['rejected', 'withdrawn']);
    const assignedCount = statusCounts.reduce((total, status) => total + status.assignedCount, 0);

    let averageScore = 0;
    if (publishedEvals.length > 0) {
      const sum = publishedEvals.reduce((acc, curr) => acc + curr.totalScore, 0);
      averageScore = (sum / publishedEvals.length).toFixed(1);
    }

    // Keep proposals separate from submitted work and assignment-ready projects.
    const statusStats = [
      { name: 'Proposals & Drafts', value: proposalCount },
      { name: 'Awaiting Faculty Assignment', value: awaitingAssignmentCount },
      { name: 'Faculty Review', value: reviewCount },
      { name: 'Evaluated', value: evaluatedCount },
      { name: 'Closed', value: closedCount },
    ];

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalStudents,
          totalFaculty,
          totalProjects,
          proposalProjects: proposalCount,
          awaitingFacultyAssignment: awaitingAssignmentCount,
          assignedProjects: assignedCount,
          facultyReviewProjects: reviewCount,
          evaluatedProjects: evaluatedCount,
          averageScore,
        },
        statusStats,
        deptStats,
      }
    });
  } catch (error) {
    next(error);
  }
};

// List all registered users (Admin only) with pagination
const getAllUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const total = await User.countDocuments();
    const users = await User.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      status: 'success',
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Create user manually (Admin only)
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, department, rollNumber, facultyId, section, batch, academicYear, officialCollegeEmail } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError('User with this email already exists', 400));
    }

    const userData = { name, email, password, role, department };
    if (role === 'student') {
      if (!rollNumber || !section?.trim() || !batch?.trim() || !academicYear?.trim()) {
        return next(new AppError('Roll number, section, batch, and academic year are required for students', 400));
      }
      if (!['Computer Science', 'Information Technology'].includes(department)) {
        return next(new AppError('Student accounts are currently limited to Computer Science and Information Technology', 400));
      }
      if (!/^\d{4}\s*-\s*\d{4}$/.test(batch.trim()) || !getCohortId({ department, section, batch })) {
        return next(new AppError('Provide a valid section and batch in YYYY-YYYY format', 400));
      }
      Object.assign(userData, {
        rollNumber,
        section: section.trim().toUpperCase(),
        batch: batch.trim(),
        academicYear: academicYear.trim(),
        ...(officialCollegeEmail ? { officialCollegeEmail: officialCollegeEmail.trim().toLowerCase() } : {}),
      });
    }
    else if (role === 'faculty') userData.facultyId = facultyId;

    const user = await User.create(userData);
    
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      status: 'success',
      user: userResponse,
    });
  } catch (error) {
    next(error);
  }
};

const updateStudentCohort = async (req, res, next) => {
  try {
    const { department, section, batch, academicYear } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'student') {
      return next(new AppError('Student account not found', 404));
    }
    if (!['Computer Science', 'Information Technology'].includes(department)) {
      return next(new AppError('Student accounts are currently limited to Computer Science and Information Technology', 400));
    }
    if (!section?.trim() || !academicYear?.trim() || !getCohortId({ department, section, batch })) {
      return next(new AppError('Provide department, section, academic year, and batch in YYYY-YYYY format', 400));
    }

    user.department = department;
    user.section = section.trim().toUpperCase();
    user.batch = batch.trim();
    user.academicYear = academicYear.trim();
    await user.save();
    res.status(200).json({ status: 'success', user });
  } catch (error) {
    next(error);
  }
};

const updateStudentDetails = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'student') {
      return next(new AppError('Student account not found', 404));
    }

    const { name, email, rollNumber, department, section, batch, academicYear } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();
    if (!name?.trim() || !normalizedEmail || !rollNumber?.trim()) {
      return next(new AppError('Name, email, and roll number are required', 400));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return next(new AppError('Provide a valid email address', 400));
    }
    if (!['Computer Science', 'Information Technology'].includes(department)) {
      return next(new AppError('Student accounts are currently limited to Computer Science and Information Technology', 400));
    }
    if (!section?.trim() || !academicYear?.trim() || !getCohortId({ department, section, batch })) {
      return next(new AppError('Provide department, section, academic year, and a valid batch in YYYY-YYYY format', 400));
    }

    const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
    if (existingUser) {
      return next(new AppError('A user with this email already exists', 400));
    }

    user.name = name.trim();
    user.email = normalizedEmail;
    user.rollNumber = rollNumber.trim();
    user.department = department;
    user.section = section.trim().toUpperCase();
    user.batch = batch.trim();
    user.academicYear = academicYear.trim();
    await user.save();

    const safeUser = user.toObject();
    delete safeUser.password;
    res.status(200).json({ status: 'success', user: safeUser });
  } catch (error) {
    next(error);
  }
};

// Export evaluations sheet (CSV download)
const getFacultyUsers = async (req, res, next) => {
  try {
    const faculty = await User.find({ role: 'faculty' }).sort({ name: 1 });
    res.status(200).json({
      status: 'success',
      users: faculty,
    });
  } catch (error) {
    next(error);
  }
};

const createFaculty = async (req, res, next) => {
  try {
    const { name, email, password, department } = req.body;
    if (!name || !email || !password) {
      return next(new AppError('Name, email, and password are required for faculty accounts', 400));
    }

    const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingUser) {
      return next(new AppError('A faculty account with this email already exists', 400));
    }

    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role: 'faculty',
      department: department || 'Computer Science',
      facultyId: req.body.facultyId || req.body.facultyProfile?.facultyId || `FAC-${Date.now()}`,
      availability: req.body.availability || req.body.facultyProfile?.availability || 'available',
      facultyProfile: normalizeFacultyProfile(req.body),
    });

    const safeUser = user.toObject();
    delete safeUser.password;

    res.status(201).json({
      status: 'success',
      user: safeUser,
    });
  } catch (error) {
    next(error);
  }
};

const updateFacultyProfile = async (req, res, next) => {
  try {
    const faculty = await User.findById(req.params.id);
    if (!faculty || faculty.role !== 'faculty') {
      return next(new AppError('Faculty member not found', 404));
    }

    const { name, department, availability, password, ...rest } = req.body;

    if (name) faculty.name = name.trim();
    if (department) faculty.department = department;
    if (availability) faculty.availability = availability;
    faculty.facultyProfile = { ...faculty.facultyProfile, ...normalizeFacultyProfile(rest) };
    if (req.body.facultyId) faculty.facultyId = req.body.facultyId;
    if (password) faculty.password = password;

    await faculty.save();

    const safeFaculty = faculty.toObject();
    delete safeFaculty.password;

    res.status(200).json({
      status: 'success',
      user: safeFaculty,
    });
  } catch (error) {
    next(error);
  }
};

const exportEvaluationsReport = async (req, res, next) => {
  try {
    const evaluations = await Evaluation.find()
      .populate({
        path: 'projectId',
        populate: { path: 'teamMembers', select: 'name email' }
      })
      .populate('evaluatorId', 'name email department')
      .sort({ updatedAt: -1 });

    const csvData = exportEvaluationsToCSV(evaluations);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=evaluations_report.csv');
    res.status(200).send(csvData);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSystemStats,
  getAllUsers,
  createUser,
  updateStudentCohort,
  updateStudentDetails,
  getFacultyUsers,
  createFaculty,
  updateFacultyProfile,
  exportEvaluationsReport,
};
