const winston = require('winston');
const path = require('path');

// Shared format components
const timestampFormat = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' });
const printFormat = winston.format.printf(({ timestamp, level, message }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

// Console format: includes colorize for developer experience
const consoleFormat = winston.format.combine(
  timestampFormat,
  winston.format.colorize(),
  printFormat
);

// File format: no ANSI color codes so log files are readable
const fileFormat = winston.format.combine(
  timestampFormat,
  printFormat
);

const transports = [
  new winston.transports.Console({ format: consoleFormat }),
];

// In production, also log to files for persistence
if (process.env.NODE_ENV === 'production') {
  const logDir = path.join(__dirname, '../../logs');

  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      format: fileFormat,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: fileFormat,
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports,
});

module.exports = logger;
