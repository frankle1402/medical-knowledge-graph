import { test, expect } from '../fixtures/auth';
import { sel } from '../utils/selectors';
import { api } from '../utils/api';

const TEMPLATE_NAME = 'E2E AI 模板（临时）';
const GRAPH_NAME = 'E2E AI 流程图谱-' + Date.now();

test.describe('AI 生成 + 评审（mock LLM）', () => {
  let token: string;
  let templateId: string;
  let graphId: string;

  test.beforeAll(async () => {
    const auth = await api.login('admin', 'admin123');
    token = auth.token;
    const tpl = await api.ensureTemplate(token, { name: TEMPLATE_NAME });
    templateId = tpl.id;
    const g = await api.createGraph(token, { graph_name: GRAPH_NAME });
    graphId = g.graph_id;
  });

  test.afterAll(async () => {
    if (graphId) await api.deleteGraph(token, graphId).catch(() => {});
  });

  test('选择模板 → 生成 → ReviewPanel 出现 → 全部通过', async ({ page, loginAs }) => {
    await loginAs('admin');
    await page.goto(`/graphs/${encodeURIComponent(graphId)}`);
    await expect(page.locator(sel.editor.page)).toBeVisible();

    // ---- Open AI generate dialog ----
    await page.locator(sel.editor.aiGenerateBtn).click();
    await expect(page.locator('[data-testid="ai-generate-modal"]')).toBeVisible();

    // The select uses aria-label "提示词模板"; pick our template by name.
    await page.locator('select[aria-label="提示词模板"]').selectOption({ label: TEMPLATE_NAME });
    await page.locator('input[aria-label="主题"]').fill('静脉输液与输血');
    await page.locator('form[aria-label="AI 生成"] button[type="submit"]').click();

    // The orchestrator hits mock-llm and returns 4 nodes / 3 relations.
    // ReviewPanel opens automatically on success.
    await expect(page.locator(sel.reviewPanel.modal)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(sel.reviewPanel.modal)).toContainText('待审核');

    // The mock returns 4 candidate nodes; verify they appear in the section.
    const nodesSection = page.locator('[data-testid="review-nodes-section"]');
    await expect(nodesSection).toBeVisible();
    await expect(nodesSection.getByText('静脉输液')).toBeVisible();
    await expect(nodesSection.getByText('排气')).toBeVisible();

    // ---- Approve all ----
    await page.locator(sel.reviewPanel.approveAll).click();

    // After approve-all, the panel closes and the canvas shows approved nodes.
    await expect(page.locator(sel.reviewPanel.modal)).toBeHidden({ timeout: 10_000 });
    // Reload from server to confirm the candidates are now persisted as approved.
    const detailRes = await fetch(`http://localhost:4000/api/graphs/${encodeURIComponent(graphId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailRes.ok).toBeTruthy();
    const detail = (await detailRes.json()) as {
      nodes: Array<{ name: string; status: string }>;
      relations: Array<{ status: string }>;
    };
    const approved = detail.nodes.filter((n) => n.status === 'approved');
    expect(approved.length).toBeGreaterThanOrEqual(4);
    expect(approved.map((n) => n.name)).toEqual(
      expect.arrayContaining(['静脉输液', '输血反应', '排气', '肝素帽']),
    );
  });
});
