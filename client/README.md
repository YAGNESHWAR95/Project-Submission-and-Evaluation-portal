# Project Evaluation Portal - Client

Frontend application for the Project Evaluation Portal built with React, Vite, and Tailwind CSS.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Development Server](#running-the-development-server)
  - [Building for Production](#building-for-production)
- [Application Architecture](#application-architecture)
  - [Routing](#routing)
  - [Authentication Flow](#authentication-flow)
  - [Theme Support](#theme-support)
- [Pages and Features](#pages-and-features)
  - [Authentication Pages](#authentication-pages)
  - [Student Pages](#student-pages)
  - [Faculty Pages](#faculty-pages)
  - [Admin Pages](#admin-pages)
- [Services (API Layer)](#services-api-layer)
- [Context Providers](#context-providers)
- [Layouts](#layouts)
- [Linting](#linting)

---

## Overview

This is the single-page application (SPA) frontend for the Project Evaluation Portal. It provides role-specific dashboards for Students, Faculty, and Admins. The interface features project submission workflows, multi-phase evaluation modals, deadline management, user administration, analytics charts, and CSV data exports.

## Tech Stack

| Technology       | Purpose                                 |
| ---------------- | --------------------------------------- |
| React 19         | UI component library                    |
| Vite 8           | Build tool and development server       |
| React Router 7   | Client-side routing and navigation      |
| Tailwind CSS 4   | Utility-first CSS framework             |
| Axios            | HTTP client for API communication       |
| Framer Motion    | Animations and transitions              |
| Lucide React     | Icon library                            |
| Recharts         | Charting library for analytics          |
| OxLint           | Fast JavaScript/TypeScript linter       |

## Project Structure

```
client/
  index.html            # HTML entry point
  vite.config.js        # Vite configuration (React + Tailwind plugins)
  package.json          # Dependencies and scripts
  .oxlintrc.json        # OxLint configuration
  public/               # Static assets
  src/
    main.jsx            # Application entry point (React root render)
    App.jsx             # Root component with routing configuration
    App.css             # Application-level styles
    index.css           # Global styles and Tailwind directives
    assets/             # Static assets (images, fonts, etc.)
    context/
      AuthContext.jsx   # Authentication state and methods
      ThemeContext.jsx   # Theme (light/dark) state management
    hooks/
      useAuth.js        # Custom hook for consuming AuthContext
    layouts/
      AuthLayout.jsx        # Layout wrapper for login/register pages
      DashboardLayout.jsx   # Sidebar + header layout for dashboards
      ProtectedRoute.jsx    # Route guard with role-based access control
    pages/
      auth/
        Login.jsx       # User login page
        Register.jsx    # User registration page
      student/
        Dashboard.jsx   # Student dashboard with project list and status
        SubmitProject.jsx # Project submission form with file upload
      faculty/
        Dashboard.jsx       # Faculty dashboard with evaluation queue
        EvaluateModal.jsx   # Multi-phase evaluation modal
      admin/
        Dashboard.jsx       # Admin dashboard with analytics and charts
        ManageUsers.jsx     # User management panel
        ManageDeadlines.jsx # Deadline editor panel
    services/
      api.js                # Axios instance with interceptors
      authService.js        # Authentication API calls
      projectService.js     # Project CRUD and upload API calls
      evaluationService.js  # Evaluation API calls
      adminService.js       # Admin-specific API calls
    utils/                  # Utility functions and helpers
```

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm
- The backend server running (default: `http://localhost:5000`)

### Installation

```bash
cd client
npm install
```

### Running the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173` by default.

### Building for Production

```bash
npm run build
```

The output will be generated in the `dist/` directory. Preview the production build with:

```bash
npm run preview
```

---

## Application Architecture

### Routing

The application uses React Router v7 with the following route structure:

| Path          | Component            | Access         | Description                         |
| ------------- | -------------------- | -------------- | ----------------------------------- |
| `/login`      | Login                | Public         | User login form                     |
| `/register`   | Register             | Public         | User registration form              |
| `/`           | DashboardDispatcher  | Authenticated  | Redirects to role-specific dashboard|
| `/submit`     | SubmitProject        | Student only   | Project submission form             |
| `/users`      | ManageUsers          | Admin only     | User management panel               |
| `/deadlines`  | ManageDeadlines      | Admin only     | Deadline management panel           |
| `*`           | Redirect to `/`      | --             | Catch-all redirect                  |

Public routes (login, register) use the `AuthLayout`. All authenticated routes are wrapped in `ProtectedRoute` and rendered within the `DashboardLayout`.

### Authentication Flow

1. Users log in via the `/login` page, which calls the auth API and receives JWT tokens.
2. The access token is stored in memory (via AuthContext) and the refresh token is stored as an HTTP-only cookie.
3. The Axios instance (`api.js`) includes request interceptors that attach the access token to outgoing requests.
4. When an access token expires, the interceptor automatically calls the refresh endpoint to obtain a new token.
5. On logout, both tokens are cleared and the user is redirected to the login page.

### Theme Support

The application supports light and dark modes via `ThemeContext`. The theme preference is persisted in local storage and applied globally through CSS class toggling.

---

## Pages and Features

### Authentication Pages

**Login** (`/login`)
- Email and password form
- Error display for invalid credentials
- Redirect to dashboard on success

**Register** (`/register`)
- Multi-field registration form (name, email, password, role, department, roll number)
- Role-specific field visibility (roll number shown only for students)
- Client-side validation

### Student Pages

**Dashboard** (`/`)
- Lists all projects submitted by the student
- Displays project status, evaluation progress, and scores
- Links to project submission

**Submit Project** (`/submit`)
- Project title, description, and group member fields
- File upload with progress indication
- Supports both direct cloud upload (Cloudinary) and server-side upload
- File integrity verification via checksums

### Faculty Pages

**Dashboard** (`/`)
- Evaluation queue showing assigned projects pending review
- Project preview with submitted files and metadata
- Opens the evaluation modal for grading

**Evaluate Modal**
- Multi-phase evaluation form (phase-based scoring)
- Score breakdown input with individual criteria
- Written feedback field
- Automatic total score computation

### Admin Pages

**Dashboard** (`/`)
- Platform-wide analytics and summary statistics
- Charts powered by Recharts (submission trends, score distributions, etc.)
- Quick links to management panels

**Manage Users** (`/users`)
- Searchable and filterable user list
- Role assignment and updates
- Faculty-student assignment management

**Manage Deadlines** (`/deadlines`)
- CRUD operations for submission deadlines
- Phase association and date/time picker
- Active/inactive toggle

---

## Services (API Layer)

All API communication is handled through a centralized Axios instance with automatic token management.

| Service              | File                    | Description                                      |
| -------------------- | ----------------------- | ------------------------------------------------ |
| API Client           | `api.js`                | Axios instance with base URL, interceptors for auth tokens, and automatic token refresh |
| Auth Service         | `authService.js`        | Login, register, logout, refresh, and profile API calls |
| Project Service      | `projectService.js`     | Project CRUD, file upload URL requests, and submission operations |
| Evaluation Service   | `evaluationService.js`  | Evaluation listing and submission API calls       |
| Admin Service        | `adminService.js`       | User management, analytics, and CSV export API calls |

## Context Providers

| Context        | File                | Description                                                   |
| -------------- | ------------------- | ------------------------------------------------------------- |
| AuthContext    | `AuthContext.jsx`   | Manages authentication state (user, tokens, login/logout methods). Wraps the entire app. |
| ThemeContext   | `ThemeContext.jsx`   | Manages light/dark theme state with local storage persistence. |

## Layouts

| Layout              | File                    | Description                                                  |
| ------------------- | ----------------------- | ------------------------------------------------------------ |
| AuthLayout          | `AuthLayout.jsx`        | Centered card layout for login and registration pages        |
| DashboardLayout     | `DashboardLayout.jsx`   | Sidebar navigation with header, role-based menu items, and content area |
| ProtectedRoute      | `ProtectedRoute.jsx`    | Route guard component that checks authentication status and user role before rendering child routes |

## Linting

The project uses OxLint for fast JavaScript linting:

```bash
npm run lint
```

Configuration is defined in `.oxlintrc.json`.
