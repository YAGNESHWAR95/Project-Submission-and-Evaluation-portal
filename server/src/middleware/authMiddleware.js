const { verifyAccessToken } = require('../utils/tokenGenerator');
const User = require('../models/User');
const AppError = require('../utils/AppError');

const protect = async (req, res, next) => {
  try {
    let token;
    
    // Check Authorization Header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      return next(new AppError('Authentication required. Please provide a valid token.', 401));
    }

    // Verify token payload
    const decoded = verifyAccessToken(token);
    
    // Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // Attach user information to request context
    req.user = currentUser;
    next();
  } catch (error) {
    return next(new AppError('Token invalid or expired. Access denied.', 401));
  }
};

module.exports = { protect };
