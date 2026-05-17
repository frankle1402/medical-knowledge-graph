import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { configureApiClient } from './lib/api';
import { useAuthStore } from './stores';
import { LoginPage } from './pages/LoginPage';
import { GraphListPage } from './pages/GraphListPage';
import { GraphEditorPage } from './pages/GraphEditorPage';
import { RequireAuth } from './components/auth';

/**
 * App entry. Owned by Agent-D.
 *
 * ROUTE-POINTS:agent-e — when Agent-E adds Templates / Users / AILogs / Settings
 * pages, register them inside the <Routes> block below in the marked region.
 * Each new route should be wrapped in <RequireAuth><RequireRole roles={[...]}>...
 * (RequireRole is owned by Agent-E).
 */
export function App() {
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
    [],
  );

  useEffect(() => {
    configureApiClient({
      baseUrl: import.meta.env.VITE_API_BASE_URL,
      onUnauthorized: () => {
        logout();
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      },
    });
  }, [logout]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/graphs"
            element={
              <RequireAuth>
                <GraphListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/graphs/:id"
            element={
              <RequireAuth>
                <GraphEditorPage />
              </RequireAuth>
            }
          />
          {/* ROUTE-POINTS:agent-e — register Templates / Users / AILogs / Settings here */}
          <Route path="/" element={<Navigate to="/graphs" replace />} />
          <Route path="*" element={<Navigate to="/graphs" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
