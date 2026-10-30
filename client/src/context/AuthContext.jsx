import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as loginApi, register as registerApi, logout as logoutApi, getMe } from '../services/authService';

const AuthContext = createContext();

const getStoredUser = () => {
  try {
    const saved = sessionStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.warn('Stored user session could not be restored.', error);
    try { sessionStorage.removeItem('user'); } catch { /* Storage may be unavailable. */ }
    return null;
  }
};

const getStoredToken = () => {
  try {
    return sessionStorage.getItem('token') || null;
  } catch (error) {
    console.warn('Stored authentication token could not be restored.', error);
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getStoredUser);
  const [token, setToken] = useState(getStoredToken);
  const [loading, setLoading] = useState(true);

  // Load current user details if token exists
  useEffect(() => {
    const loadUser = async () => {
      if (token) {
        try {
          const data = await getMe();
          setUser(data.user);
          try {
            sessionStorage.setItem('user', JSON.stringify(data.user));
          } catch (storageError) {
            console.warn('Verified user session could not be cached.', storageError);
          }
        } catch (error) {
          console.error('Session verification failed:', error);
          await logoutUser();
        }
      }
      setLoading(false);
    };

    loadUser();
  }, [token]);

  const loginUser = async (email, password) => {
    setLoading(true);
    try {
      const data = await loginApi(email, password);
      setToken(data.token);
      setUser(data.user);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const registerUser = async (userData) => {
    setLoading(true);
    try {
      return await registerApi(userData);
    } finally {
      setLoading(false);
    }
  };

  const logoutUser = async () => {
    setLoading(true);
    try {
      await logoutApi();
    } catch (e) {
      console.warn('Backend logout failed, clearing client state:', e);
    } finally {
      setToken(null);
      setUser(null);
      try { sessionStorage.removeItem('token'); } catch (storageError) { console.warn('Session storage cleanup failed.', storageError); }
      try { sessionStorage.removeItem('user'); } catch (storageError) { console.warn('Session storage cleanup failed.', storageError); }
      try { localStorage.removeItem('token'); } catch (storageError) { console.warn('Local storage cleanup failed.', storageError); }
      try { localStorage.removeItem('user'); } catch (storageError) { console.warn('Local storage cleanup failed.', storageError); }
      setLoading(false);
    }
  };

  const isStudent = user?.role === 'student';
  const isFaculty = user?.role === 'faculty';
  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      loginUser,
      registerUser,
      logoutUser,
      isStudent,
      isFaculty,
      isAdmin
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
