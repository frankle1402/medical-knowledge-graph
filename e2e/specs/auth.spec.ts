import { test, expect, CREDENTIALS, type Role } from '../fixtures/auth';
import { sel } from '../utils/selectors';

const ROLES: Role[] = ['admin', 'expert', 'operator'];

test.describe('登录流（auth）', () => {
  for (const role of ROLES) {
    test(`${role} 登录成功后跳转到 /graphs`, async ({ page, loginAs }) => {
      await loginAs(role);
      await expect(page).toHaveURL(/\/graphs(?:\?|$)/);
      // The list page header always renders the platform title regardless of
      // whether the user has any graphs yet.
      await expect(page.locator(sel.list.heading).first()).toBeVisible();
      // The greeting line includes the role label.
      await expect(page.getByText(new RegExp(`欢迎，${CREDENTIALS[role].username}`))).toBeVisible();
    });
  }

  test('错误密码被拒绝并显示提示', async ({ page }) => {
    await page.goto('/login');
    await page.locator(sel.login.username).fill('admin');
    await page.locator(sel.login.password).fill('definitely-wrong');
    await page.locator(sel.login.submit).click();
    // The login form surfaces the backend error message in a role=alert div.
    await expect(page.locator('form[aria-label="登录"] [role="alert"]')).toBeVisible();
    // We are still on /login.
    await expect(page).toHaveURL(/\/login/);
  });

  test('未登录访问受保护路由会被重定向到 /login', async ({ page }) => {
    await page.goto('/graphs');
    await expect(page).toHaveURL(/\/login/);
  });
});
