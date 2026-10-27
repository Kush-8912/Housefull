import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { reconnectSocket } from '../lib/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from the httpOnly cookie on load.
  useEffect(() => {
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { user: u } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (payload) => {
    const { user: u } = await api('/auth/register', { method: 'POST', body: payload });
    setUser(u);
    return u;
  }, []);

  // `accessToken` comes from Google's sign-in popup; `role` only matters when
  // this creates the account.
  const loginWithGoogle = useCallback(async (accessToken, role) => {
    const { user: u, created } = await api('/auth/google', { method: 'POST', body: { accessToken, role } });
    setUser(u);
    return { user: u, created };
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  // Re-identify the live connection whenever the signed-in account changes.
  const userId = user?._id;
  useEffect(() => {
    if (!loading) reconnectSocket();
  }, [userId, loading]);

  // After the profile page saves account changes.
  const updateUser = useCallback((u) => setUser(u), []);

  const value = useMemo(
    () => ({ user, loading, login, register, loginWithGoogle, logout, updateUser }),
    [user, loading, login, register, loginWithGoogle, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
