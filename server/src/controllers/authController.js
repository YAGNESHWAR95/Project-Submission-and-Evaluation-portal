const User = require('../models/User');
const AppError = require('../utils/AppError');
const { getCohortId } = require('../utils/cohort');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
} = require('../utils/tokenGenerator');

// Password strength validation helper
const validatePasswordStrength = (password) => {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
};

// Cookie options helper
const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

// Register User
const register = async (req, res, next) => {
  try {
    const { name, email, password, role, department, rollNumber, facultyId, section, batch, academicYear, officialCollegeEmail } = req.body;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedOfficialCollegeEmail = officialCollegeEmail ? officialCollegeEmail.trim().toLowerCase() : undefined;

    // Admin accounts cannot be created through registration
    if (role === 'admin') {
      return next(new AppError('Admin accounts cannot be created through registration', 403));
    }

    // Validate password strength
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return next(new AppError(passwordError, 400));
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return next(new AppError('User with this email already exists', 400));
    }

    // Role-specific fields
    const userData = { name, email: normalizedEmail, password, role, department };
    if (role === 'student') {
      if (!rollNumber) return next(new AppError('Roll number is required for students', 400));
      if (!['Computer Science', 'Information Technology'].includes(department)) {
        return next(new AppError('Student registration is currently limited to Computer Science and Information Technology', 400));
      }
      if (!section?.trim() || !batch?.trim() || !academicYear?.trim()) {
        return next(new AppError('Section, batch, and academic year are required for students', 400));
      }
      if (!/^\d{4}\s*-\s*\d{4}$/.test(batch.trim())) {
        return next(new AppError('Batch must use the format YYYY-YYYY, for example 2023-2027', 400));
      }
      if (!getCohortId({ department, section, batch })) {
        return next(new AppError('The provided department, section, and batch do not form a valid cohort', 400));
      }
      userData.rollNumber = rollNumber;
      userData.section = section.trim().toUpperCase();
      userData.batch = batch.trim();
      userData.academicYear = academicYear.trim();
      if (normalizedOfficialCollegeEmail) {
        userData.officialCollegeEmail = normalizedOfficialCollegeEmail;
      }
    } else if (role === 'faculty') {
      if (!facultyId) return next(new AppError('Faculty ID is required for faculty members', 400));
      userData.facultyId = facultyId;
    }

    const user = await User.create(userData);

    // Don't send back password
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      user: userResponse,
    });
  } catch (error) {
    next(error);
  }
};

// Login User
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }

    // Fetch user with password (since select: false in model)
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return next(new AppError('Incorrect email or password', 401));
    }

    // Tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set refresh token in HttpOnly Cookie
    res.cookie('refreshToken', refreshToken, getCookieOptions());

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      status: 'success',
      token: accessToken,
      user: userResponse,
    });
  } catch (error) {
    next(error);
  }
};

// Refresh Access Token
const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return next(new AppError('Refresh token not found. Please log in.', 401));
    }

    // Verify token
    const decoded = verifyRefreshToken(refreshToken);

    // Find User
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new AppError('User not found.', 401));
    }

    // Generate new Access Token
    const accessToken = generateAccessToken(user);

    res.status(200).json({
      status: 'success',
      token: accessToken,
    });
  } catch (error) {
    return next(new AppError('Invalid or expired refresh token. Please login again.', 401));
  }
};

// Logout User
const logout = async (req, res, next) => {
  try {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Get current user profile
const getMe = async (req, res, next) => {
  try {
    // req.user is already the full user document from authMiddleware
    res.status(200).json({
      status: 'success',
      user: req.user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  getMe,
};
