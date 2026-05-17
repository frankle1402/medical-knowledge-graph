import { describe, expect, it, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { RequireRole } from '../RequireRole';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useAuthStore } from '../../../stores';
import type { User } from '@mkg/shared';

const ADMIN: User = {
  id: '00000000-0000-0000-0000-000000000001',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
};

const OPERATOR: User = { ...ADMIN, id: '00000000-0000-0000-0000-000000000002', username: 'op', role: 'operator' };

describe('RequireRole', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 't', user: null, initialized: true });
  });

  it('renders children when user role is allowed', () => {
    useAuthStore.setState({ token: 't', user: ADMIN, initialized: true });
    renderWithProviders(
      <RequireRole roles={['admin']}>
        <div>secret</div>
      </RequireRole>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders forbidden alert when user role is not allowed', () => {
    useAuthStore.setState({ token: 't', user: OPERATOR, initialized: true });
    renderWithProviders(
      <RequireRole roles={['admin']}>
        <div>secret</div>
      </RequireRole>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByTestId('require-role-forbidden')).toBeInTheDocument();
  });

  it('renders children when no roles array is provided', () => {
    useAuthStore.setState({ token: 't', user: OPERATOR, initialized: true });
    renderWithProviders(
      <RequireRole>
        <div>open</div>
      </RequireRole>,
    );
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('renders nothing while user is still loading (null)', () => {
    useAuthStore.setState({ token: 't', user: null, initialized: false });
    const { container } = renderWithProviders(
      <RequireRole roles={['admin']}>
        <div>secret</div>
      </RequireRole>,
    );
    expect(container.textContent).toBe('');
  });

  it('renders custom fallback when provided', () => {
    useAuthStore.setState({ token: 't', user: OPERATOR, initialized: true });
    renderWithProviders(
      <RequireRole roles={['admin']} fallback={<div>custom-deny</div>}>
        <div>secret</div>
      </RequireRole>,
    );
    expect(screen.getByText('custom-deny')).toBeInTheDocument();
    expect(screen.queryByTestId('require-role-forbidden')).not.toBeInTheDocument();
  });
});
