import api from './api';

// Get list of projects based on logged-in user role
export const getProjects = async () => {
  const response = await api.get('/projects');
  return response.data.projects;
};

// Get specific project details
export const getProjectById = async (id) => {
  const response = await api.get(`/projects/${id}`);
  return response.data.project;
};

export const getFacultyReviewSubmissions = async () => {
  const response = await api.get('/projects/faculty-review');
  return response.data.submissions;
};

export const getProposalReviewProjects = async () => {
  const response = await api.get('/projects/proposal-review');
  return response.data.projects;
};

// Run ML similarity check for the project
export const runUniquenessCheck = async (id) => {
  const response = await api.post(`/projects/${id}/uniqueness-check`);
  return response.data.result;
};

export const submitProposalForReview = async (id) => {
  const response = await api.post(`/projects/${id}/submit-proposal`);
  return response.data;
};

// Request direct-upload presigned signature
export const getUploadUrl = async (projectId, purpose) => {
  const response = await api.get(`/projects/upload-url`, {
    params: { projectId, purpose },
  });
  return response.data.data;
};

// Create a new project proposal.
export const createProject = async (projectData) => {
  const response = await api.post('/projects', projectData);
  return response.data.project;
};

// Update project (DRAFT)
export const updateProject = async (id, projectData) => {
  const response = await api.put(`/projects/${id}`, projectData);
  return response.data.project;
};

// Upload file directly to project with purpose
export const uploadProjectFile = async (id, file, purpose, onProgress) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);

  const response = await api.post(`/projects/${id}/files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percentCompleted);
      }
    },
  });
  return response.data;
};

export const downloadProjectFile = async (id, purpose, versionNumber, phase) => {
  const response = await api.get(`/projects/${id}/files/${purpose}/download`, {
    responseType: 'blob',
    params: {
      ...(versionNumber ? { versionNumber } : {}),
      ...(phase ? { stagePhase: phase } : {}),
    },
  });
  return response.data;
};

export const uploadStageDocument = async (projectId, phase, purpose, file, onProgress) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);
  const response = await api.post(`/projects/${projectId}/stages/${phase}/files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(Math.round((event.loaded * 100) / event.total));
    },
  });
  return response.data;
};

export const submitStageDocument = async (projectId, phase, deploymentUrl) => {
  const response = await api.post(`/projects/${projectId}/stages/${phase}/submit`, { deploymentUrl });
  return response.data;
};

export const saveStageDraft = async (projectId, phase, deploymentUrl) => {
  const response = await api.post(`/projects/${projectId}/stages/${phase}/save`, { deploymentUrl });
  return response.data.submission;
};

export const reviewStageSubmission = async (projectId, phase, version, review) => {
  const response = await api.post(`/projects/${projectId}/stages/${phase}/versions/${version}/review`, review);
  return response.data.submission;
};

export const grantStageRevisionAccess = async (projectId, phase, version) => {
  const response = await api.post(`/projects/${projectId}/stages/${phase}/versions/${version}/grant-revision`);
  return response.data.submission;
};

export const reviewProposal = async (projectId, decision, facultyComment = '') => {
  const response = await api.post(`/projects/${projectId}/review`, { decision, facultyComment });
  return response.data.project;
};

// Submit an approved proposal (runs the exact-file check and changes status to SUBMITTED).
export const submitDraftProject = async (id) => {
  const response = await api.post(`/projects/${id}/submit`);
  return response.data.project;
};

// Withdraw project
export const withdrawProject = async (id) => {
  const response = await api.post(`/projects/${id}/withdraw`);
  return response.data;
};

// Get active deadlines for student
export const getStudentDeadlines = async (projectId) => {
  const response = await api.get('/projects/deadlines', {
    params: projectId ? { projectId } : undefined,
  });
  return response.data.deadlines;
};

// Submit metadata register call (backward compatibility)
export const submitProject = async (projectData) => {
  const response = await api.post('/projects/submit', projectData);
  return response.data.project;
};

// Admin allocation call
export const assignReviewer = async (projectId, facultyId) => {
  const response = await api.post('/projects/assign-reviewer', { projectId, facultyId });
  return response.data.project;
};

export const getFacultyRecommendations = async (projectId) => {
  const response = await api.get(`/projects/${projectId}/faculty-recommendations`);
  return response.data.data;
};

export const assignFacultyToProject = async (projectId, facultyId) => {
  const response = await api.post(`/projects/${projectId}/assign-faculty`, { facultyId });
  return response.data.project;
};

export const getProjectMessages = async (projectId) => {
  const response = await api.get(`/projects/${projectId}/messages`);
  return response.data.messages;
};

export const sendProjectMessage = async (projectId, content) => {
  const response = await api.post(`/projects/${projectId}/messages`, { content });
  return response.data.message;
};

export const requestProjectRevision = async (projectId, revision) => {
  const response = await api.post(`/projects/${projectId}/request-revision`, revision);
  return response.data.project;
};

export const grantProjectRevisionAccess = async (projectId) => {
  const response = await api.post(`/projects/${projectId}/grant-revision-access`);
  return response.data.project;
};

export const requestProjectRevisionAccess = async (projectId, reason) => {
  const response = await api.post(`/projects/${projectId}/revision-access-request`, { reason });
  return response.data.request;
};

export const respondToProjectRevisionAccessRequest = async (projectId, decisionData) => {
  const response = await api.post(`/projects/${projectId}/revision-access-request/respond`, decisionData);
  return response.data;
};

export const resubmitProjectRevision = async (projectId) => {
  const response = await api.post(`/projects/${projectId}/resubmit`);
  return response.data.project;
};

// Get students list (for team member selection)
export const getStudents = async () => {
  const response = await api.get('/projects/students');
  return response.data.users;
};

