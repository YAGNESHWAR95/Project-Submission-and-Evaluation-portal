import api from './api';

export const createComplaint = async ({ projectId, subject, description }) => {
  const response = await api.post('/complaints', { projectId, subject, description });
  return response.data.complaint;
};

export const getMyComplaints = async () => {
  const response = await api.get('/complaints/my');
  return response.data.complaints;
};

export const getAllComplaints = async () => {
  const response = await api.get('/complaints');
  return response.data.complaints;
};

export const updateComplaintStatus = async (id, { status, adminResponse }) => {
  const response = await api.patch(`/complaints/${id}/status`, { status, adminResponse });
  return response.data.complaint;
};
