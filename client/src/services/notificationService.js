import api from './api';

export const getMyNotifications = async () => {
  const response = await api.get('/notifications/my');
  return response.data;
};

export const markAsRead = async (id) => {
  const response = await api.patch(`/notifications/${id}/read`);
  return response.data.notification;
};

export const markAllAsRead = async () => {
  const response = await api.patch('/notifications/read-all');
  return response.data;
};

export const clearMyNotifications = async () => {
  const response = await api.delete('/notifications/clear-all');
  return response.data;
};
