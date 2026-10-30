const dotenv = require('dotenv');
const path = require('path');

// CRITICAL: Load environment variables BEFORE any other require
// (tokenGenerator.js, corsOptions.js, etc. read process.env at module load time)
dotenv.config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { configureCloudinary } = require('./config/cloudinary');

const PORT = process.env.PORT || 5000;

// Async startup to ensure DB is connected before accepting requests
const startServer = async () => {
  // Fail fast on incomplete storage configuration before connecting to MongoDB.
  configureCloudinary();

  // Initialize DB Connection (awaited so server doesn't start before DB is ready)
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`Server listening in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  // Graceful shutdown helper
  const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed.');
      process.exit(0);
    });
    // Force shutdown after 10s if graceful close hangs
    setTimeout(() => process.exit(1), 10000);
  };

  // Container/cloud deployment signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', async (err) => {
    logger.error(`UNHANDLED REJECTION: ${err.message}. Shutting down...`);
    logger.error(err.stack);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(1);
    });
  });
};

// Uncaught exceptions must be caught at the top level (before server starts)
process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION: ${err.message}. Shutting down...`);
  logger.error(err.stack);
  process.exit(1);
});

startServer();
