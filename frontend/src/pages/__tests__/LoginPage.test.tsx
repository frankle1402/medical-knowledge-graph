import { describe, expect, it, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { LoginPage } from '../LoginPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useAuthStore } from '../../stores';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('LoginPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    useAuthStore.setState({ token: null, user: null, initialized: false });
    localStorage.clear();
  });

  it('submits credentials and stores auth token on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'tok-1',
          user: {
            id: '00000000-0000-0000-0000-000000000001',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin',
            is_active: true,
            created_at: '2024-01-01T00:00:00Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('用户名'), 'admin');
    await userEvent.type(screen.getByLabelText('密码'), 'pass1234');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('tok-1');
    });
    expect(mockNavigate).toHaveBeenCalledWith('/graphs', { replace: true });
  });

  it('renders error message when login fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: '账号或密码错误' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('用户名'), 'a');
    await userEvent.type(screen.getByLabelText('密码'), 'b');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误');
    expect(useAuthStore.getState().token).toBeNull();
  });
});
