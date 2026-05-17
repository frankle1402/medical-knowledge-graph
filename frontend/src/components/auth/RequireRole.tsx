import { type ReactNode } from 'react';
import type { UserRole } from '@mkg/shared';
import { useAuthStore } from '../../stores';

interface RequireRoleProps {
  /** If omitted, just requires an authenticated user. */
  roles?: UserRole[];
  children: ReactNode;
  /** Custom fallback element when role check fails. */
  fallback?: ReactNode;
}

/**
 * Role-based guard. Must be wrapped inside <RequireAuth>, which already handles
 * the unauthenticated → /login redirect and hydration state. RequireRole only
 * checks the role of the *already-loaded* user.
 */
export function RequireRole({ roles, children, fallback }: RequireRoleProps) {
  const user = useAuthStore((s) => s.user);

  // If RequireAuth hasn't yet populated the user, render nothing (RequireAuth
  // shows its own "loading" state). Once user is non-null we evaluate roles.
  if (!user) {
    return null;
  }
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return (
      <>
        {fallback ?? (
          <div
            role="alert"
            data-testid="require-role-forbidden"
            style={{
              padding: 32,
              color: '#DC2626',
              textAlign: 'center',
              fontSize: 14,
            }}
          >
            无权限访问该页面
          </div>
        )}
      </>
    );
  }
  return <>{children}</>;
}
