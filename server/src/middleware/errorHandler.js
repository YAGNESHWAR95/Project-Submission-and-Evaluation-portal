const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (err.name === 'MulterError') {
    err.statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    err.status = 'fail';
    err.message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded file exceeds the 100 MB limit.'
      : 'The uploaded file could not be accepted.';
  } else if (err.message?.startsWith('Only PDF, PPT, and ZIP files are allowed')) {
    err.statusCode = 400;
    err.status = 'fail';
  }

  // Handle specific MongoDB errors
  if (err.name === 'ValidationError') {
    err.statusCode = 400;
    err.status = 'fail';
    const messages = Object.values(err.errors).map(el => el.message);
    err.message = `Validation failed: ${messages.join(', ')}`;
  }

  if (err.code === 11000) {
    err.statusCode = 409;
    err.status = 'fail';
    // Format duplicate key errors nicely
    const keys = Object.keys(err.keyValue).join(', ');
    err.message = `Duplicate field value entered for: ${keys}. Please use another value.`;
    
    // Explicitly check for team membership index block
    if (err.message.includes('teamMembers') && err.message.includes('deadline')) {
      err.message = 'A student in this team is already enrolled in another project for this deadline.';
    }
  }

  if (err.name === 'CastError') {
    err.statusCode = 400;
    err.status = 'fail';
    err.message = `Invalid format for field ${err.path}: ${err.value}`;
  }

  if (err.name === 'JsonWebTokenError') {
    err.statusCode = 401;
    err.status = 'fail';
    err.message = 'Invalid token. Please log in again.';
  }

  if (err.name === 'TokenExpiredError') {
    err.statusCode = 401;
    err.status = 'fail';
    err.message = 'Token has expired. Please refresh your session.';
  }

  logger.error(`${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}${err.stack ? `\n${err.stack}` : ''}`);

  res.status(err.statusCode).json({
    status: err.status,
    message: err.statusCode >= 500 ? 'The server could not complete this request. Please try again shortly.' : err.message,
  });
};

module.exports = errorHandler;
