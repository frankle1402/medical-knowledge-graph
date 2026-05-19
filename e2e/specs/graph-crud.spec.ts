import { test, expect } from '../fixtures/auth';
import { sel } from '../utils/selectors';
import { api } from '../utils/api';

const GRAPH_NAME = 'E2E 测试图谱-CRUD-' + Date.now();

test.describe('图谱 + 节点 CRUD（admin）', () => {
  let token: string;

  test.beforeAll(async () => {
    const auth = await api.login('admin', 'admin123');
    token = auth.token;
  });

  test.afterAll(async () => {
    // Best-effort cleanup; tests are tolerant if the graph is already gone.
    const list = await api.listGraphs(token);
    for (const g of list) {
      if (g.graph_name === GRAPH_NAME) await api.deleteGraph(token, g.graph_id);
    }
  });

  test('创建图谱 → 进入编辑器 → 新建节点 → 删除图谱', async ({ page, loginAs }) => {
    await loginAs('admin');

    // ---- Create the graph through the modal ----
    await page.locator(sel.list.newGraphBtn).click();
    await expect(page.locator(sel.createGraph.modal)).toBeVisible();
    await page.locator(sel.createGraph.name).fill(GRAPH_NAME);
    await page.locator(sel.createGraph.subject).fill('护理学');
    await page.locator(sel.createGraph.submit).click();

    // GraphListPage navigates to /graphs/:id after a successful create.
    await page.waitForURL(/\/graphs\/[^/?#]+$/, { timeout: 10_000 });
    await expect(page.locator(sel.editor.page)).toBeVisible();
    // Header shows the new graph name.
    await expect(page.getByText(GRAPH_NAME).first()).toBeVisible();

    // ---- Add a node via the toolbar button (more reliable than canvas dblclick) ----
    await page.locator(sel.editor.addNodeBtn).click();
    await expect(page.locator(sel.createNode.modal)).toBeVisible();
    await page.locator('input[aria-label="名称"]').fill('静脉输液');
    // knowledge_point is the default; knowledge_type select is auto-filled.
    await page.locator('form[aria-label="新建节点"] button[type="submit"]').click();

    // The new node should appear in the canvas. Cytoscape draws on a <canvas>
    // element with no per-node DOM, so we assert via the hidden a11y mirror
    // exposed by GraphCanvas. attached (not visible) — the mirror is sr-only.
    await expect(
      page.locator(sel.editor.flowNode, { hasText: '静脉输液' }).first(),
    ).toHaveCount(1, { timeout: 10_000 });

    // ---- Navigate back to the list and delete the graph ----
    page.on('dialog', (d) => d.accept()); // confirm the native window.confirm
    await page.locator(sel.editor.backBtn).click();
    await page.waitForURL(/\/graphs(?:\?|$)/);
    await expect(page.locator(`button[aria-label="删除 ${GRAPH_NAME}"]`)).toBeVisible();
    await page.locator(`button[aria-label="删除 ${GRAPH_NAME}"]`).click();
    await expect(
      page.locator(`button[aria-label="删除 ${GRAPH_NAME}"]`),
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('编辑器对未知 graph 显示错误状态', async ({ page, loginAs }) => {
    // Navigating to a non-existent graph_id should resolve the route and
    // render an error alert with a "返回列表" button — sanity-checks that
    // the route is reachable and error UX hangs together.
    await loginAs('admin');
    await page.goto('/graphs/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('button', { name: '返回列表' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
