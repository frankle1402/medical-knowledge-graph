import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from '../UsersPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useAuthStore } from '../../stores';
import type { User } from '@mkg/shared';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api', () => ({
  usersApi: {
    list: vi.fn(),
    create: vi.fn(),
    updateRole: vi.fn(),
    remove: vi.fn(),
  },
  authApi: {
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

import { usersApi } from '../../api';

const ME: User = {
  id: '00000000-0000-0000-0000-0000000000aa',
  username: 'self-admin',
  email: 'me@example.com',
  role: 'admin',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
};

const OTHER: User = {
  id: '00000000-0000-0000-0000-0000000000bb',
  username: 'expert-bob',
  email: 'bob@example.com',
  role: 'expert',
  is_active: true,
  created_at: '2024-02-01T00:00:00Z',
};

describe('UsersPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 't', user: ME, initialized: true });
    vi.mocked(usersApi.list).mockResolvedValue([ME, OTHER]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  it('renders the user table with role labels and a self badge', async () => {
    renderWithProviders(<UsersPage />);
    expect(await screen.findByText('self-admin')).toBeInTheDocument();
    expect(screen.getByText('expert-bob')).toBeInTheDocument();
    expect(screen.getByText('你自己')).toBeInTheDocument();
    // Self row shows the role as text only (no select), other row has a select
    expect(screen.queryByLabelText('角色:self-admin')).not.toBeInTheDocument();
    expect(screen.getByLabelText('角色:expert-bob')).toBeInTheDocument();
  });

  it('hides delete button for the current user', async () => {
    renderWithProviders(<UsersPage />);
    await screen.findByText('self-admin');
    expect(screen.queryByLabelText('删除:self-admin')).not.toBeInTheDocument();
    expect(screen.getByLabelText('删除:expert-bob')).toBeInTheDocument();
  });

  it('calls updateRole and updates the row when role changes', async () => {
    vi.mocked(usersApi.updateRole).mockResolvedValue({ ...OTHER, role: 'operator' });
    renderWithProviders(<UsersPage />);
    const select = (await screen.findByLabelText('角色:expert-bob')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'operator' } });
    await waitFor(() => {
      expect(usersApi.updateRole).toHaveBeenCalledWith(OTHER.id, 'operator');
    });
  });

  it('opens the create dialog and submits a new user', async () => {
    const created: User = {
      id: '00000000-0000-0000-0000-0000000000cc',
      username: 'new-op',
      email: 'op@example.com',
      role: 'operator',
      is_active: true,
      created_at: '2024-03-01T00:00:00Z',
    };
    vi.mocked(usersApi.create).mockResolvedValue(created);

    renderWithProviders(<UsersPage />);
    await screen.findByText('self-admin');

    await userEvent.click(screen.getByRole('button', { name: '新建用户' }));
    const modal = await screen.findByTestId('create-user-modal');
    expect(modal).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('用户名'), 'new-op');
    await userEvent.type(screen.getByLabelText('邮箱'), 'op@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'pw123456');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(usersApi.create).toHaveBeenCalledWith({
        username: 'new-op',
        email: 'op@example.com',
        password: 'pw123456',
        role: 'operator',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('new-op')).toBeInTheDocument();
    });
  });

  it('shows toast error when create returns USERNAME_TAKEN', async () => {
    const { ApiError } = await import('../../lib/api');
    vi.mocked(usersApi.create).mockRejectedValue(
      new ApiError('用户名已被占用', 409, 'USERNAME_TAKEN'),
    );

    renderWithProviders(<UsersPage />);
    await screen.findByText('self-admin');

    await userEvent.click(screen.getByRole('button', { name: '新建用户' }));
    await userEvent.type(screen.getByLabelText('用户名'), 'self-admin');
    await userEvent.type(screen.getByLabelText('邮箱'), 'x@x.com');
    await userEvent.type(screen.getByLabelText('密码'), 'pw123456');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(usersApi.create).toHaveBeenCalled();
    });
    // Toast renders as a status region somewhere on the page; assert by text.
    await waitFor(() => {
      expect(document.body.textContent).toContain('用户名已被占用');
    });
  });
});
