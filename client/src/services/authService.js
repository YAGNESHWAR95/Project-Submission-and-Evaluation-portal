import api from './api';

export const login = async (email, password) => {
  const response = await api.post('/auth/login', { email, password });
  if (response.data.token) {
    try { sessionStorage.setItem('token', response.data.token); } catch (error) { console.warn('Session token could not be cached.', error); }
    try { sessionStorage.setItem('user', JSON.stringify(response.data.user)); } catch (error) { console.warn('Session profile could not be cached.', error); }
    try { localStorage.removeItem('token'); } catch (error) { console.warn('Legacy token cleanup failed.', error); }
    try { localStorage.removeItem('user'); } catch (error) { console.warn('Legacy profile cleanup failed.', error); }
  }
  return response.data;
};

export const register = async (userData) => {
  const response = await api.post('/auth/register', userData);
  return response.data;
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } finally {
    try { sessionStorage.removeItem('token'); } catch (error) { console.warn('Session token cleanup failed.', error); }
    try { sessionStorage.removeItem('user'); } catch (error) { console.warn('Session profile cleanup failed.', error); }
    try { localStorage.removeItem('token'); } catch (error) { console.warn('Legacy token cleanup failed.', error); }
    try { localStorage.removeItem('user'); } catch (error) { console.warn('Legacy profile cleanup failed.', error); }
  }
};

export const getMe = async () => {
  const response = await api.get('/auth/me');
  return response.data;
};
