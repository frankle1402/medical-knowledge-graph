import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores';
import { authApi } from '../../api';

interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const setUser = useAuthStore((s) => s.setUser);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setInitialized(true);
      return;
    }
    if (user) {
      setInitialized(true);
      return;
    }
    authApi
      .me()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setInitialized(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          logout();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, user, setUser, setInitialized, logout]);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!initialized) {
    return (
      <div style={{ padding: 24, color: '#6b7280' }} role="status">
        加载中…
      </div>
    );
  }
  return <>{children}</>;
}
