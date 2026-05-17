import { test, expect } from '@playwright/test';

test.describe('系统/健康检查', () => {
  test('GET /api/health 返回 200 ok', async ({ request }) => {
    const res = await request.get('http://localhost:4000/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('GET /api/docs 渲染 Swagger UI', async ({ page }) => {
    const res = await page.goto('http://localhost:4000/api/docs/');
    // Swagger UI is served as HTML; status 200, body contains the swagger DOM.
    expect(res?.status()).toBe(200);
    await expect(page.locator('#swagger-ui')).toBeVisible({
      timeout: 10_000,
    });
  });
});
