import { test as base, expect, type Page } from '@playwright/test';
import { sel } from '../utils/selectors';

export type Role = 'admin' | 'expert' | 'operator';

export const CREDENTIALS: Record<Role, { username: string; password: string }> = {
  admin: { username: 'admin', password: 'admin123' },
  expert: { username: 'expert1', password: 'expert123' },
  // op1 password is `op12345` per backend/prisma/seed.ts (the harness brief
  // claimed `op123` but the seeded hash is for `op12345`).
  operator: { username: 'op1', password: 'op12345' },
};

export async function loginAs(page: Page, role: Role): Promise<void> {
  const creds = CREDENTIALS[role];
  await page.goto('/login');
  await page.locator(sel.login.username).fill(creds.username);
  await page.locator(sel.login.password).fill(creds.password);
  await page.locator(sel.login.submit).click();
  // After successful login the app redirects to /graphs.
  await page.waitForURL(/\/graphs(?:\?|$)/, { timeout: 15_000 });
}

interface AuthFixtures {
  loginAs: (role: Role) => Promise<void>;
}

/**
 * Extended test that carries a `loginAs` helper. We do NOT pre-login in a
 * worker fixture because some specs need to log out / switch roles.
 */
export const test = base.extend<AuthFixtures>({
  loginAs: async ({ page }, use) => {
    await use((role) => loginAs(page, role));
  },
});

export { expect };
