const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const AppError = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');

const sanitizeObject = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item));
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
        return;
      }

      value[key] = sanitizeObject(value[key]);
    });
  }

  return value;
};

const sanitizeRequestData = (req, res, next) => {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) {
    Object.keys(req.query).forEach((key) => {
      if (key.startsWith('$') || key.includes('.')) {
        delete req.query[key];
      } else {
        req.query[key] = sanitizeObject(req.query[key]);
      }
    });
  }
  if (req.params) {
    Object.keys(req.params).forEach((key) => {
      if (key.startsWith('$') || key.includes('.')) {
        delete req.params[key];
      } else {
        req.params[key] = sanitizeObject(req.params[key]);
      }
    });
  }
  next();
};

// Route Imports
const authRoutes = require('./routes/authRoutes');
const deadlineRoutes = require('./routes/deadlineRoutes');
const projectRoutes = require('./routes/projectRoutes');
const evalRoutes = require('./routes/evalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const corsOptions = require('./config/corsOptions');

const app = express();

// Security: Set HTTP response headers
app.use(helmet());

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} request received at ${req.originalUrl}`);
  next();
});

// Configure Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Security: Sanitize request data against NoSQL injection without breaking Express 5
app.use(sanitizeRequestData);

// Rate limiting on authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per window
  message: {
    status: 'fail',
    message: 'Too many requests from this IP. Please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Mount API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/deadlines', deadlineRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/evaluations', evalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/team-invitations', invitationRoutes);
app.use('/team-invitations', invitationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/notifications', notificationRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/complaints', complaintRoutes);
app.use('/projects', projectRoutes);
app.use('/deadlines', deadlineRoutes);

// Fallback for undefined API routes
app.all('{*path}', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found on this server`, 404));
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
