const AppError = require('../utils/AppError');

const validateBody = (requiredFields) => {
  return (req, res, next) => {
    const missing = [];
    requiredFields.forEach(field => {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        missing.push(field);
      }
    });

    if (missing.length > 0) {
      return next(new AppError(`Missing required request body fields: ${missing.join(', ')}`, 400));
    }
    next();
  };
};

module.exports = { validateBody };
