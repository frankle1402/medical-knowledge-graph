# Pack E — 前端 UI 接入（语义搜索 + 学习路径 + 同义合并）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** 在前端接入 Pack C/D 提供的 4 个新 API：语义搜索升级 NodeSearchBox、节点详情面板加学习路径侧栏、工具栏加"同义合并候选"面板。复用现有 Cytoscape + Focus Mode 基础设施。

**Architecture:** API client 层先冻结契约（独立 .ts 文件，便于 mock）；UI 组件遵循现有风格（plain CSS-in-JS、data-testid 全标）；同义合并接受 → 调 NodeService 既有的 update API（合并语义在前端实现：把 b 的关系迁到 a，删 b）。

**Tech Stack:** React 18 · Cytoscape 集成已就绪 · React Query 已用 · vitest + @testing-library

---

## 工作分支

`feature/pg-migration-pack-e-frontend`

## 输出目录（仅本 Pack 可写）

- `frontend/src/api/search.ts`（新）
- `frontend/src/api/learning.ts`（新）
- `frontend/src/components/GraphEditor/NodeSearchBox.tsx`（**修改** — 加语义模式开关）
- `frontend/src/components/GraphEditor/__tests__/NodeSearchBox.test.tsx`（更新）
- `frontend/src/components/GraphEditor/LearningPathPanel.tsx`（新）
- `frontend/src/components/GraphEditor/__tests__/LearningPathPanel.test.tsx`
- `frontend/src/components/GraphEditor/SynonymMergePanel.tsx`（新）
- `frontend/src/components/GraphEditor/__tests__/SynonymMergePanel.test.tsx`
- `frontend/src/components/NodePanel/NodePanel.tsx`（**修改** — 加"📚 学习路径"按钮）
- `frontend/src/pages/GraphEditorPage.tsx`（**修改** — 接入两个新面板）
- `e2e/utils/selectors.ts`（加 selectors 键）

## 边界（不可动）

- 后端代码（Pack B/C/D 范围）
- `GraphCanvas.tsx`（除非要在画布上 highlight 同义节点 — 那也用现有 selection API）
- 现有 Focus Mode 行为

## 关键依赖

- ✅ Pack C 接口稳定（POST /api/graphs/:id/search）
- ✅ Pack D 接口稳定（learning-path、knowledge-gap、synonym-candidates）
- ✅ Pack B 数据已切 PG（Pack C/D 都依赖 PG）

---

## API client 模板（先建，确保契约冻结）

### `frontend/src/api/search.ts`

```ts
import { http } from './http';

export interface SearchMatch {
  node: { node_id: string; name: string; node_type: string; [k: string]: unknown };
  score: number;
  neighbors?: Array<{ node_id: string; name: string; node_type: string }>;
}
export interface SearchResponse { matches: SearchMatch[]; }

export const searchApi = {
  async semantic(graphId: string, q: string, k = 10, includeNeighbors = true): Promise<SearchResponse> {
    return http.post(`/api/graphs/${graphId}/search`, { q, k, include_neighbors: includeNeighbors });
  },
};
```

### `frontend/src/api/learning.ts`

```ts
import { http } from './http';

export interface LearningPathStep { node_id: string; name: string; depth: number; via: string; }
export interface LearningPathResponse {
  target: { node_id: string; name: string };
  path: LearningPathStep[];
}

export interface KnowledgeGap { node_id: string; name: string; blocking: string[]; }
export interface KnowledgeGapResponse { gaps: KnowledgeGap[]; }

export interface SynonymCandidate {
  a: { node_id: string; name: string };
  b: { node_id: string; name: string };
  score: number;
}
export interface SynonymCandidatesResponse { candidates: SynonymCandidate[]; }

export const learningApi = {
  learningPath: (nodeId: string, depth = 5) =>
    http.get<LearningPathResponse>(`/api/nodes/${nodeId}/learning-path?depth=${depth}`),
  knowledgeGap: (graphId: string, mastered: string[], targets: string[]) =>
    http.post<KnowledgeGapResponse>(`/api/graphs/${graphId}/knowledge-gap`, { mastered, targets }),
  synonymCandidates: (graphId: string, threshold = 0.92) =>
    http.get<SynonymCandidatesResponse>(`/api/graphs/${graphId}/synonym-candidates?threshold=${threshold}`),
};
```

**Commit:** `feat(api): client modules for search + learning APIs`

---

## Task 1：NodeSearchBox 升级（子串 + 语义双模式）

**Files:** modify `frontend/src/components/GraphEditor/NodeSearchBox.tsx`

**新行为**：
- 输入框右侧加一个"🔍 语义"按钮（默认未触发，避免每次输入都打 OpenAI）
- 用户敲完关键词后点按钮 → 调 `searchApi.semantic` → 把结果替换下拉列表
- 子串模式照旧（默认）

**实现要点**：
- 状态多加一个 `isSemantic: boolean` + `semanticMatches: KGNode[]` + `loading: boolean`
- 显示来源：子串模式 vs 语义模式（在下拉顶部加 badge "语义"）
- 错误处理：API 503 时 toast "embedding 还没建好，请联系管理员"

**测试增量**：
- 点击"语义"按钮 → mock searchApi 被调一次
- 显示 score 在每行右侧

**Commit:** `feat(ui): semantic search mode in NodeSearchBox`

---

## Task 2：LearningPathPanel 组件

**Files:** create `frontend/src/components/GraphEditor/LearningPathPanel.tsx`

**Props:**
```ts
interface LearningPathPanelProps {
  nodeId: string | null;  // null 时面板隐藏
  onClose: () => void;
  onJumpToNode: (id: string) => void;  // 复用 GraphEditorPage 的聚焦逻辑
}
```

**渲染**：
- 抽屉式右侧弹出（用现有 Modal 组件或新建滑出条）
- 顶部 "📚 [target.name] 的学习路径"
- 路径列表：`A → B → C → 目标`（左侧深度大的在前）
- 每行点击调 `onJumpToNode` 进入聚焦
- 加载态：骨架屏；错误态：toast 并展示重试按钮

**集成**：
- `NodePanel.tsx` 加 "📚 学习路径" 按钮，点击调 `onShowLearningPath(node_id)` prop
- `GraphEditorPage.tsx` 加 state `learningPathNodeId: string | null`，响应按钮设值
- `onJumpToNode` 接到现有 `handleEnterFocus` — Focus Mode 自动接管视觉

**测试**：
- mock `learningApi.learningPath` 返回 3 步路径，断言渲染 3 个 li
- 点击第 2 行 → onJumpToNode 被调用 with 正确 id
- API 失败 → 显示错误态

**Commit:** `feat(ui): learning path panel + NodePanel integration`

---

## Task 3：SynonymMergePanel 组件

**Files:** create `frontend/src/components/GraphEditor/SynonymMergePanel.tsx`

**触发**：左工具栏加按钮 "🔄 同义合并候选"，点击打开此面板（Modal 形式）

**Props:**
```ts
interface SynonymMergePanelProps {
  graphId: string;
  open: boolean;
  onClose: () => void;
  onMerged: () => void;  // 通知 GraphEditorPage 重新拉图
}
```

**渲染**：
- threshold slider（0.85 – 0.99）默认 0.92
- 候选列表：每行 `[a.name] ≈ [b.name]  (score 0.95)  [合并→a] [合并→b] [跳过]`
- 点击 [合并→a]：调用 `mergeNodes(b, a)` 工具函数

**合并语义**（前端实现，复用现有 NodeService API）：

```ts
async function mergeNodes(removeId: string, keepId: string, graphId: string) {
  // 1. 拿全图（已在 store）
  const { relations } = useGraphStore.getState();
  // 2. 把所有指向 removeId 的关系改为指向 keepId
  const toMigrate = relations.filter(r => r.source_id === removeId || r.target_id === removeId);
  for (const r of toMigrate) {
    await relationsApi.update(r.relation_id, {
      source_id: r.source_id === removeId ? keepId : r.source_id,
      target_id: r.target_id === removeId ? keepId : r.target_id,
    });
  }
  // 3. 删除 removeId 节点
  await nodesApi.remove(removeId);
}
```

**注意**：
- 关系迁移可能产生重复键（unique 约束 `(source, target, type)`），合并前要先去重 — 业务决策：保留 confidence 高的那条
- 这是写多条 API，要带 try/catch + 失败回滚提示
- 操作前 confirm "合并后 X 节点会被删除，关系迁到 Y，无法撤销"

**测试**：
- 准备含 3 候选的 mock 响应，点 [合并] 验证调用顺序
- 错误处理：单条 update 失败时显示错误并停止

**Commit:** `feat(ui): synonym merge panel`

---

## Task 4：GraphEditorPage 接入

**Files:** modify `frontend/src/pages/GraphEditorPage.tsx`

**改动**：

1. 状态：
```ts
const [learningPathNodeId, setLearningPathNodeId] = useState<string | null>(null);
const [synonymPanelOpen, setSynonymPanelOpen] = useState(false);
```

2. 工具栏：在 NodeSearchBox 下面加按钮 "🔄 同义合并候选"

3. 主区：
```tsx
<LearningPathPanel
  nodeId={learningPathNodeId}
  onClose={() => setLearningPathNodeId(null)}
  onJumpToNode={(id) => { setLearningPathNodeId(null); handleEnterFocus(id); }}
/>
<SynonymMergePanel
  graphId={graphId}
  open={synonymPanelOpen}
  onClose={() => setSynonymPanelOpen(false)}
  onMerged={() => { /* refetch */ }}
/>
```

4. NodePanel props 加 `onShowLearningPath={setLearningPathNodeId}`

**Commit:** `feat(ui): wire learning path + synonym merge into GraphEditorPage`

---

## Task 5：e2e selectors 加键

**Files:** modify `e2e/utils/selectors.ts`

加入：

```ts
editor: {
  // ... existing keys
  semanticSearchBtn: '[data-testid="semantic-search-btn"]',
  learningPathPanel: '[data-testid="learning-path-panel"]',
  synonymPanel: '[data-testid="synonym-merge-panel"]',
  synonymMergeBtnByPair: (a: string, b: string) =>
    `[data-testid="synonym-merge-${a}-${b}"]`,
}
```

**Commit:** 与 task 4 合并 OK

---

## Verification

1. `npm -w frontend test` 全过（vitest）
2. `npm -w frontend run build` 通过
3. 手动 dev 跑 http://localhost:3002：
   - 进图谱编辑器
   - 子串模式搜索"心" → 看到"心率""心律失常"等
   - 切语义模式输入"心跳节奏不齐" → 期待"心律失常"排首
   - 选中"心力衰竭"节点 → NodePanel 点"📚 学习路径" → 看到面板列出前置链
   - 点路径中"心率" → Focus Mode 切到该节点
   - 工具栏点"🔄 同义合并候选" → 看到候选列表
   - 选一条合并 → 图刷新，被合节点消失，关系迁移正确
4. 跑 e2e suite 看不破坏现有 specs

---

## 风险

- **合并节点的 unique 冲突**：业务侧决定保留 confidence 更高的关系，必须在 mergeNodes 前预先 dedupe
- **OpenAI 成本**：语义搜索每次都调 — 默认非自动模式，靠用户主动点
- **threshold 滑块**：动态调用 API 可能频繁打后端 — 加 debounce 300ms

---

## Commits 总数

约 5 个：api client、NodeSearchBox 升级、LearningPathPanel、SynonymMergePanel、GraphEditorPage 集成。
