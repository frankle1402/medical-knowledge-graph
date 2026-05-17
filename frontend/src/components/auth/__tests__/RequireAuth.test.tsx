import { describe, expect, it, vi, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { RequireAuth } from '../RequireAuth';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useAuthStore } from '../../../stores';
import { tokenStorage } from '../../../lib/api';

describe('RequireAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    tokenStorage.clear();
    useAuthStore.setState({ token: null, user: null, initialized: false });
  });

  it('redirects unauthenticated users to /login', () => {
    renderWithProviders(
      <Routes>
        <Route
          path="/private"
          element={
            <RequireAuth>
              <div>secret</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>,
      { route: '/private' },
    );
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });

  it('hydrates user from /api/auth/me when token is present', async () => {
    tokenStorage.set('tok');
    useAuthStore.setState({ token: 'tok', user: null, initialized: false });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '00000000-0000-0000-0000-000000000001',
          username: 'admin',
          email: 'admin@example.com',
          role: 'admin',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderWithProviders(
      <Routes>
        <Route
          path="/private"
          element={
            <RequireAuth>
              <div>secret</div>
            </RequireAuth>
          }
        />
      </Routes>,
      { route: '/private' },
    );
    await waitFor(() => {
      expect(screen.getByText('secret')).toBeInTheDocument();
    });
    expect(useAuthStore.getState().user?.username).toBe('admin');
  });

  it('logs out when /api/auth/me fails', async () => {
    tokenStorage.set('tok');
    useAuthStore.setState({ token: 'tok', user: null, initialized: false });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'expired' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithProviders(
      <Routes>
        <Route
          path="/private"
          element={
            <RequireAuth>
              <div>secret</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>,
      { route: '/private' },
    );
    await waitFor(() => {
      expect(screen.getByText('login-page')).toBeInTheDocument();
    });
  });
});
