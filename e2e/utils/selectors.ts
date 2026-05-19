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
    // Pack C/D: semantic search + learning panels.
    semanticSearchBtn: '[data-testid="semantic-search-btn"]',
    semanticBadge: '[data-testid="semantic-badge"]',
    semanticScore: (nodeId: string) => `[data-testid="semantic-score-${nodeId}"]`,
    showLearningPathBtn: '[data-testid="show-learning-path-btn"]',
    openSynonymMergeBtn: '[data-testid="open-synonym-merge-btn"]',
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
  learningPath: {
    panel: '[data-testid="learning-path-panel"]',
    close: '[data-testid="learning-path-close"]',
    list: '[data-testid="learning-path-list"]',
    step: (nodeId: string) => `[data-testid="learning-path-step-${nodeId}"]`,
    target: '[data-testid="learning-path-target"]',
    skeleton: '[data-testid="learning-path-skeleton"]',
    empty: '[data-testid="learning-path-empty"]',
    notFound: '[data-testid="learning-path-not-found"]',
    error: '[data-testid="learning-path-error"]',
    retry: '[data-testid="learning-path-retry"]',
  },
  synonymMerge: {
    panel: '[data-testid="synonym-merge-panel"]',
    threshold: '[data-testid="synonym-threshold"]',
    thresholdValue: '[data-testid="synonym-threshold-value"]',
    loading: '[data-testid="synonym-loading"]',
    empty: '[data-testid="synonym-empty"]',
    embeddingsNotReady: '[data-testid="synonym-embeddings-not-ready"]',
    candidate: (aId: string, bId: string) =>
      `[data-testid="synonym-candidate-${aId}-${bId}"]`,
    keepA: (aId: string, bId: string) =>
      `[data-testid="synonym-keep-a-${aId}-${bId}"]`,
    keepB: (aId: string, bId: string) =>
      `[data-testid="synonym-keep-b-${aId}-${bId}"]`,
    confirmModal: '[data-testid="synonym-confirm-modal"]',
    confirmOk: '[data-testid="synonym-confirm-ok"]',
    confirmCancel: '[data-testid="synonym-confirm-cancel"]',
  },
};
