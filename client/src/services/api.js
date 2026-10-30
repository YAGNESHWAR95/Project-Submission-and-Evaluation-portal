import axios from 'axios';
import { API_BASE_URL } from '../utils/constants';
import { getFriendlyApiErrorMessage } from '../utils/apiErrorMessage';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Attach Access Token
api.interceptors.request.use(
  (config) => {
    let token = null;
    try {
      token = sessionStorage.getItem('token');
    } catch (error) {
      console.warn('Session token could not be read.', error);
    }
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Seamless Refresh Token handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = originalRequest?.url || '';

    if (!error.response) {
      console.error('API network error:', {
        url: requestUrl,
        method: originalRequest?.method,
        message: error.message,
        stack: error.stack,
      });
    }

    // Check if error is 401 and has not been retried yet
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !requestUrl.includes('/auth/login') && !requestUrl.includes('/auth/refresh')) {
      originalRequest._retry = true;
      try {
        console.log('Access token expired. Retrying session refresh...');
        const response = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        
        const { token } = response.data;
        try { sessionStorage.setItem('token', token); } catch (storageError) { console.warn('Refreshed session token could not be cached.', storageError); }
        try { localStorage.removeItem('token'); } catch (storageError) { console.warn('Legacy token cleanup failed.', storageError); }
        
        // Re-run the initial request
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      } catch (refreshError) {
        console.error('Session expired. Logging out...');
        try { sessionStorage.removeItem('token'); } catch (storageError) { console.warn('Session token cleanup failed.', storageError); }
        try { sessionStorage.removeItem('user'); } catch (storageError) { console.warn('Session profile cleanup failed.', storageError); }
        try { localStorage.removeItem('token'); } catch (storageError) { console.warn('Legacy token cleanup failed.', storageError); }
        try { localStorage.removeItem('user'); } catch (storageError) { console.warn('Legacy profile cleanup failed.', storageError); }
        const invitationPath = window.location.pathname.startsWith('/team-invitations/')
          ? window.location.pathname
          : null;
        const loginPath = invitationPath
          ? `/login?redirect=${encodeURIComponent(invitationPath)}`
          : '/login';
        window.location.href = loginPath;
        return Promise.reject(refreshError);
      }
    }

    error.message = getFriendlyApiErrorMessage(error);
    if (error.response?.status >= 500 && error.response.data && typeof error.response.data === 'object') {
      error.response.data.message = error.message;
    }
    return Promise.reject(error);
  }
);

export default api;
