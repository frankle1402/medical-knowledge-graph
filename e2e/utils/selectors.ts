/**
 * Shared selectors for the medical KG frontend. Centralized so that if a UI
 * component renames an aria-label or test-id, only one file changes.
 */
export const sel = {
  // LoginPage
  login: {
    username: 'input[aria-label="用户名"]',
    password: 'input[aria-label="密码"]',
    submit: 'form[aria-label="登录"] button[type="submit"]',
    errorAlert: '[role="alert"]',
  },
  // GraphListPage
  list: {
    heading: 'text=医学知识图谱平台',
    newGraphBtn: 'button:has-text("新建图谱")',
    logoutBtn: 'button:has-text("退出")',
    listGrid: '[data-testid="graph-list"]',
    deleteBtnByName: (name: string) => `button[aria-label="删除 ${name}"]`,
  },
  createGraph: {
    modal: '[data-testid="create-graph-modal"]',
    name: 'input[aria-label="图谱名称"]',
    subject: 'input[aria-label="学科"]',
    submit: 'form[aria-label="新建图谱"] button[type="submit"]',
  },
  // GraphEditorPage
  editor: {
    page: '[data-testid="graph-editor-page"]',
    backBtn: 'button:has-text("← 返回")',
    leftToolbar: '[data-testid="left-toolbar"]',
    addNodeBtn: '[data-testid="left-toolbar"] button:has-text("+ 新建节点")',
    aiGenerateBtn: 'button:has-text("AI 生成图谱")',
    canvasPane: '[data-testid="graph-canvas"]',
    flowNode: '[data-testid="canvas-nodes"] li',
    // Focus mode (Neo4j-style 1-hop subgraph isolation).
    nodeSearchInput: '[data-testid="node-search-input"]',
    nodeSearchResult: (nodeId: string) => `[data-testid="node-search-result-${nodeId}"]`,
    focusNodeBtn: '[data-testid="focus-node-btn"]',
    focusStatusBar: '[data-testid="focus-status-bar"]',
    clearFocusBtn: '[data-testid="clear-focus-btn"]',
    focusedMirrorNode: '[data-testid="canvas-nodes"] li[data-focus="focused"]',
    dimmedMirrorNode: '[data-testid="canvas-nodes"] li[data-focus="dimmed"]',
  },
  createNode: {
    modal: '[data-testid="create-node-modal"]',
  },
  reviewPanel: {
    modal: '[data-testid="review-panel"]',
    approveAll: '[data-testid="review-approve-all"]',
    approveSelected: '[data-testid="review-approve-selected"]',
    rejectAll: '[data-testid="review-reject-all"]',
  },
};
