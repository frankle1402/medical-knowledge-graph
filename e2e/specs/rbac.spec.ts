import { test, expect } from '../fixtures/auth';
import { sel } from '../utils/selectors';
import { api } from '../utils/api';

test.describe('角色权限（RBAC）', () => {
  test('operator 进 /users 看到无权限提示（不能进入用户管理）', async ({ page, loginAs }) => {
    await loginAs('operator');
    await page.goto('/users');
    // RequireRole renders a forbidden alert when role !== admin.
    await expect(page.locator('[data-testid="require-role-forbidden"]')).toBeVisible();
    await expect(page.getByText(/无权限访问/)).toBeVisible();
  });

  test('operator 进 /templates 也会被禁', async ({ page, loginAs }) => {
    await loginAs('operator');
    await page.goto('/templates');
    await expect(page.locator('[data-testid="require-role-forbidden"]')).toBeVisible();
  });

  test('admin 能正常进入 /users 与 /templates', async ({ page, loginAs }) => {
    await loginAs('admin');
    await page.goto('/users');
    // No forbidden alert; the users page renders its own content.
    await expect(page.locator('[data-testid="require-role-forbidden"]')).toHaveCount(0);
    await page.goto('/templates');
    await expect(page.locator('[data-testid="require-role-forbidden"]')).toHaveCount(0);
  });

  test('operator 调 /api/ai/jobs/:id/approve-all 被后端拒绝（403）', async ({ page: _page }) => {
    // Operators can call POST /api/ai/generate but cannot approve. We verify
    // the backend RBAC by calling the protected endpoint directly with the
    // operator's token.
    const op = await api.login('op1', 'op12345');
    const res = await fetch('http://localhost:4000/api/ai/jobs/00000000-0000-0000-0000-000000000000/approve-all', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${op.token}`,
        'content-type': 'application/json',
      },
    });
    // 403 (forbidden) is the expected RBAC response. We do NOT want 401
    // (unauthorized — token rejected) and we do NOT want 200/404 (which
    // would mean the role gate is broken).
    expect(res.status).toBe(403);
  });
});
