# Project Evaluation Portal - Server

Backend REST API for the Project Evaluation Portal built with Express.js, MongoDB, and JWT authentication.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Seeding](#database-seeding)
  - [Running the Server](#running-the-server)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [Projects](#projects)
  - [Evaluations](#evaluations)
  - [Deadlines](#deadlines)
  - [Admin](#admin)
- [Data Models](#data-models)
- [Middleware](#middleware)
- [Services](#services)
- [Error Handling](#error-handling)
- [File Uploads](#file-uploads)
- [Logging](#logging)

---

## Overview

This server powers a multi-role academic project evaluation system. It supports three user roles -- Student, Faculty, and Admin -- each with distinct permissions and workflows. Students submit projects with file uploads, Faculty evaluate submissions through a multi-phase grading pipeline, and Admins manage users, deadlines, and platform-wide analytics.

## Tech Stack

| Technology   | Purpose                              |
| ------------ | ------------------------------------ |
| Node.js      | Runtime environment                  |
| Express 5    | Web framework                        |
| MongoDB      | Database                             |
| Mongoose 9   | ODM / data modeling                  |
| JWT          | Access and refresh token auth        |
| bcryptjs     | Password hashing                     |
| Multer       | File upload handling                 |
| Cloudinary   | Cloud file storage (optional)        |
| Winston      | Structured logging                   |
| CORS         | Cross-origin resource sharing        |
| cookie-parser| HTTP cookie parsing                  |
| dotenv       | Environment variable management      |
| nodemon      | Development auto-restart (dev only)  |

## Project Structure

```
server/
  .env                  # Environment variables (not committed)
  .env.example          # Environment template
  package.json          # Dependencies and scripts
  uploads/              # Local file upload storage (fallback)
  src/
    server.js           # Entry point: env config, DB connect, listen
    app.js              # Express app: middleware, routes, error handler
    config/
      db.js             # MongoDB connection via Mongoose
      cloudinary.js     # Cloudinary SDK configuration
      corsOptions.js    # CORS whitelist and options
    controllers/
      authController.js      # Register, login, logout, refresh, profile
      projectController.js   # CRUD, file upload URLs, integrity checks
      evalController.js      # Phase-based grading operations
      deadlineController.js  # Deadline CRUD
      adminController.js     # User management, analytics, CSV export
    middleware/
      authMiddleware.js      # JWT verification (access + refresh tokens)
      roleMiddleware.js      # Role-based access guard
      uploadMiddleware.js    # Multer config for file uploads
      validateRequest.js     # Request body validation
      errorHandler.js        # Global error response formatter
    models/
      User.js           # User schema (student, faculty, admin)
      Project.js         # Project schema with group and file metadata
      Evaluation.js      # Multi-phase evaluation schema
      Deadline.js        # Submission deadline schema
    routes/
      authRoutes.js      # /api/auth/*
      projectRoutes.js   # /api/projects/*
      evalRoutes.js      # /api/evaluations/*
      deadlineRoutes.js  # /api/deadlines/*
      adminRoutes.js     # /api/admin/*
    services/
      uploadValidationService.js # Document signature, archive, and PDF text validation
      reportService.js        # CSV metrics and report generation
      notificationService.js  # Notification dispatch service
    utils/
      AppError.js        # Custom application error class
      logger.js          # Winston logger configuration
      seed.js            # Database seeding script
      tokenGenerator.js  # JWT access/refresh token helpers
```

## Getting Started

### Prerequisites

- Node.js v18 or higher
- MongoDB (local instance or MongoDB Atlas)
- npm

### Installation

```bash
cd server
npm install
```

### Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable                | Description                                   | Default / Example                              |
| ----------------------- | --------------------------------------------- | ---------------------------------------------- |
| `PORT`                  | Server port                                   | `5000`                                         |
| `NODE_ENV`              | Environment mode                              | `development`                                  |
| `MONGO_URI`             | MongoDB connection string                     | `mongodb://127.0.0.1:27017/project_portal`     |
| `JWT_ACCESS_SECRET`     | Secret key for short-lived access tokens      | *(required)*                                   |
| `JWT_REFRESH_SECRET`    | Secret key for long-lived refresh tokens      | *(required)*                                   |
| `SERVER_URL`            | Public API origin used by project-scoped upload metadata; required for production local storage | `http://localhost:5000` |
| `CLOUDINARY_CLOUD_NAME` | Optional Cloudinary SDK configuration; project documents continue to use local disk storage | *(leave empty with the other Cloudinary variables for local storage)* |
| `CLOUDINARY_API_KEY`    | Optional Cloudinary SDK configuration; all three Cloudinary variables must be set together | *(leave empty with the other Cloudinary variables)* |
| `CLOUDINARY_API_SECRET` | Optional Cloudinary SDK configuration; never returned to the client | *(leave empty with the other Cloudinary variables)* |

### Database Seeding

Populate the database with sample users and data:

```bash
npm run seed
```

### Running the Server

Development mode (with auto-restart via nodemon):

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The server will start on the port specified in your `.env` file (default: 5000).

---

## API Reference

All endpoints are prefixed with `/api`. Protected routes require a valid JWT access token in the `Authorization` header (`Bearer <token>`) or via HTTP-only cookies.

### Authentication

Base path: `/api/auth`

| Method | Endpoint    | Description                          | Auth Required |
| ------ | ----------- | ------------------------------------ | ------------- |
| POST   | `/register` | Register a new user                  | No            |
| POST   | `/login`    | Login and receive tokens             | No            |
| POST   | `/logout`   | Logout and clear refresh token       | Yes           |
| POST   | `/refresh`  | Refresh the access token             | Yes (cookie)  |
| GET    | `/profile`  | Get current user profile             | Yes           |

### Projects

Base path: `/api/projects`

| Method | Endpoint        | Description                              | Auth Required | Roles            |
| ------ | --------------- | ---------------------------------------- | ------------- | ---------------- |
| GET    | `/`             | List projects (filtered by role)         | Yes           | All              |
| GET    | `/:id`          | Get single project details               | Yes           | All              |
| POST   | `/`             | Create / submit a new project            | Yes           | Student          |
| PUT    | `/:id`          | Update an existing project               | Yes           | Student (owner)  |
| DELETE | `/:id`          | Delete a project                         | Yes           | Student (owner)  |
| POST   | `/upload-url`   | Get a signed upload URL or upload a file | Yes           | Student          |

### Evaluations

Base path: `/api/evaluations`

| Method | Endpoint | Description                              | Auth Required | Roles   |
| ------ | -------- | ---------------------------------------- | ------------- | ------- |
| GET    | `/`      | List evaluations                         | Yes           | All     |
| POST   | `/`      | Submit an evaluation for a project phase | Yes           | Faculty |

### Deadlines

Base path: `/api/deadlines`

| Method | Endpoint | Description                    | Auth Required | Roles        |
| ------ | -------- | ------------------------------ | ------------- | ------------ |
| GET    | `/`      | List all deadlines             | Yes           | All          |
| POST   | `/`      | Create a new deadline          | Yes           | Admin        |
| PUT    | `/:id`   | Update an existing deadline    | Yes           | Admin        |
| DELETE | `/:id`   | Delete a deadline              | Yes           | Admin        |

### Admin

Base path: `/api/admin`

| Method | Endpoint      | Description                        | Auth Required | Roles |
| ------ | ------------- | ---------------------------------- | ------------- | ----- |
| GET    | `/users`      | List all users                     | Yes           | Admin |
| PUT    | `/users/:id`  | Update user role or assignments    | Yes           | Admin |
| GET    | `/analytics`  | Platform-wide analytics and stats  | Yes           | Admin |
| GET    | `/export`     | Export evaluation data as CSV      | Yes           | Admin |

---

## Data Models

### User

| Field        | Type     | Description                                |
| ------------ | -------- | ------------------------------------------ |
| `name`       | String   | Full name                                  |
| `email`      | String   | Unique email address                       |
| `password`   | String   | Hashed password (bcryptjs)                 |
| `role`       | String   | One of: `student`, `faculty`, `admin`      |
| `department` | String   | Department or program                      |
| `rollNumber` | String   | Student roll number (students only)        |

### Project

| Field        | Type       | Description                                   |
| ------------ | ---------- | --------------------------------------------- |
| `title`      | String     | Project title                                 |
| `description`| String     | Project description                           |
| `members`    | [ObjectId] | References to User (group members)            |
| `submittedBy`| ObjectId   | Reference to the submitting user              |
| `files`      | [Object]   | Uploaded file metadata (name, URL, checksum)  |
| `groupId`    | String     | Group identifier (compound indexed)           |
| `status`     | String     | Submission status                             |

### Evaluation

| Field       | Type     | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `project`   | ObjectId | Reference to the evaluated project       |
| `evaluator` | ObjectId | Reference to the faculty evaluator       |
| `phase`     | String   | Evaluation phase identifier              |
| `scores`    | Object   | Phase-specific scoring breakdown         |
| `feedback`  | String   | Written feedback                         |
| `totalScore`| Number   | Computed total score for the phase       |

### Deadline

| Field       | Type   | Description                    |
| ----------- | ------ | ------------------------------ |
| `title`     | String | Deadline title                 |
| `phase`     | String | Associated evaluation phase    |
| `dueDate`   | Date   | Deadline date and time         |
| `isActive`  | Boolean| Whether the deadline is active |

---

## Middleware

| Middleware            | File                    | Description                                          |
| --------------------- | ----------------------- | ---------------------------------------------------- |
| Auth Middleware        | `authMiddleware.js`     | Verifies JWT access tokens and attaches user to req  |
| Role Guard             | `roleMiddleware.js`     | Restricts access based on user role                  |
| Upload Middleware      | `uploadMiddleware.js`   | Configures Multer for file uploads with size limits  |
| Request Validator      | `validateRequest.js`    | Validates request body fields before controller logic |
| Error Handler          | `errorHandler.js`       | Catches errors and sends formatted JSON responses    |

## Services

| Service                | File                       | Description                                                |
| ---------------------- | -------------------------- | ---------------------------------------------------------- |
| Upload Validation      | `uploadValidationService.js` | Validates document signatures, ZIP/PPTX contents, and extracts bounded PDF text |
| Project Documents      | `projectController.js`     | Stores files on local disk and serves them through authenticated project-scoped downloads |
| Report Service         | `reportService.js`         | Generates CSV reports with evaluation metrics              |
| Notification Service   | `notificationService.js`   | Dispatches notifications to users                          |

## Error Handling

The server uses a custom `AppError` class that extends the native `Error` with an HTTP status code and operational flag. All errors are caught by the global `errorHandler` middleware, which returns consistent JSON responses:

```json
{
  "status": "error",
  "message": "Description of what went wrong"
}
```

Unhandled promise rejections and uncaught exceptions are caught at the process level, logged, and trigger a graceful shutdown.

## File Uploads

The server supports two storage backends:

1. **Cloudinary (primary)** -- When Cloudinary environment variables are configured, the server generates signed upload URLs for direct browser-to-cloud uploads. Integrity checksums are verified on the server side.

2. **Local disk (fallback)** -- When Cloudinary is not configured, files are stored in the `uploads/` directory and served as static assets via Express at the `/uploads` path.

## Logging

Structured logging is handled by Winston. Logs include timestamps and severity levels. In development, logs are printed to the console. The logger is used throughout the application for request tracking, error reporting, and operational events.
