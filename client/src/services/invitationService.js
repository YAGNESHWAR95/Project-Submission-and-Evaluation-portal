import api from './api';

export const sendInvitation = async (projectId, studentIdentifier) => {
  try {
    console.log('Sending invitation request:', { projectId, studentIdentifier });
    const response = await api.post('/team-invitations/send', { projectId, studentIdentifier });
    return response.data;
  } catch (error) {
    console.error('Invitation request failed:', {
      projectId,
      studentIdentifier,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

export const getMyInvitations = async () => {
  const response = await api.get('/team-invitations/my');
  return response.data.invitations;
};

export const getLeaderInvitations = async () => {
  const response = await api.get('/team-invitations/leader');
  return response.data.invitations;
};

export const searchEligibleStudents = async (projectId, query) => {
  const response = await api.get('/team-invitations/students', {
    params: { projectId, query },
  });
  return {
    students: response.data.students || [],
    ineligibleStudents: response.data.ineligibleStudents || [],
  };
};

export const acceptInvitation = async (token) => {
  const response = await api.post(`/team-invitations/${token}/accept`);
  return response.data;
};

export const rejectInvitation = async (token) => {
  const response = await api.post(`/team-invitations/${token}/reject`);
  return response.data;
};
