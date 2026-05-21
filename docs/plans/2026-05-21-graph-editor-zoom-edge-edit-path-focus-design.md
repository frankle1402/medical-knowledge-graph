# 图谱编辑器：缩放按钮 / 边编辑 / 学习路径聚焦 — 设计文档

> 日期：2026-05-21
> 范围：[frontend/src/components/GraphEditor/](../../frontend/src/components/GraphEditor/) 三处增量功能 + 一处后端 schema 放开
> 影响层：前端 UI / 一行后端 zod schema；不动 DB schema、不动 Prisma migration

---

## 一、目标

在图谱编辑页 [/graphs/:id](../../frontend/src/pages/GraphEditorPage.tsx) 上加三个互不耦合的小功能：

1. **手动缩放按钮** — 左下角控制条新增 `+` / `−` 按钮，与现有"自动布局 / 适应视图"并排。
2. **双击边弹编辑表单** — 当前双击边只显示详情 + 删除；新增就地编辑：可改 `relation_type` / `description` / `confidence` / `status`。
3. **学习路径自动聚焦** — 打开 LearningPathPanel 加载完成后，画布自动进入 focus 模式：高亮目标节点 + 全部前置节点，其余节点 dim；关闭面板回到无 focus。

---

## 二、架构总览

三个功能共用一条原则：**复用现有机制，不引入新概念**。

| 功能 | 触点 | 复用 | 新增 |
| --- | --- | --- | --- |
| 缩放按钮 | [GraphCanvas.tsx:496](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L496) `floatingControlsStyle` | Cytoscape `cy.zoom()` API | 两个 button + 两个 handler |
| 边编辑 | [GraphCanvas.tsx:325](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L325) edge 事件 + [RelationForm.tsx](../../frontend/src/components/GraphEditor/RelationForm.tsx) | RelationForm + Modal + relationsApi.update | `dblclick edge` 监听 + RelationForm `mode='edit'` 分支 + GraphEditorPage modal state |
| 路径聚焦 | [LearningPathPanel.tsx:24](../../frontend/src/components/GraphEditor/LearningPathPanel.tsx#L24) | 已有 `focusedNodeIds` 多节点 focus 机制 | LearningPathPanel 在 ready 时回调聚合所有 path 节点 |

后端只动一处：[backend/src/modules/relations/relation.service.ts:22](../../backend/src/modules/relations/relation.service.ts#L22) 的 `RelationUpdateInput` zod schema 增加 `relation_type` 字段（PUT route 已存在，service.update 已读 patch，主路径已贯通）。

---

## 三、功能一：缩放 +/− 按钮

### UI

[GraphCanvas.tsx:496-503](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L496-L503) 现有控制条：

```
[ 自动布局 ] [ 适应视图 ]
```

改为：

```
[ 自动布局 ] [ 适应视图 ] [ + ] [ − ]
```

`+` `−` 按钮使用相同的 `ctrlBtnStyle`，宽度收紧（`padding: '6px 8px'`），`title` 设 "放大" / "缩小"，加 `data-testid="canvas-zoom-in"` / `canvas-zoom-out`。

### 行为

- **缩放系数**：1.2x per click
- **缩放中心**：以画布几何中心为锚点（`{x: width/2, y: height/2}`），让"对着中间内容放大"符合直觉
- **边界**：完全交给 Cytoscape 自带 `minZoom` / `maxZoom`（默认无界，等同于 `1e-50 ~ 1e50`，实际不会触底）
- **空状态**：`cyRef.current == null` 时按钮 click 是 no-op，与 `fitView` 现有行为一致

### 实现要点

```typescript
const zoomBy = (factor: number) => {
  const cy = cyRef.current;
  if (!cy) return;
  const container = cy.container();
  const w = container?.clientWidth ?? 0;
  const h = container?.clientHeight ?? 0;
  cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: w / 2, y: h / 2 } });
};
```

`zoomIn = () => zoomBy(1.2)`，`zoomOut = () => zoomBy(1 / 1.2)`。

### 测试

[GraphCanvas.test.tsx](../../frontend/src/components/GraphEditor/__tests__/) 当前没有 — 但 [TopBar / Controls 行为通过 NodeSearchBox.test 等覆盖]。本次新增组件级测试不必要：跟 `fitView` 一样依赖 cytoscape 实例，单测意义低。改放到 e2e（如果项目有）或视觉验证。

---

## 四、功能二：双击边 → 编辑表单

### 触发

[GraphCanvas.tsx:325](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L325) 现有 `cy.on('tap', 'edge', …)` → `onSelectRelation(id)`，保留。

新增 `cy.on('dblclick', 'edge', …)` → 调用新 prop `onEditRelation(relationId)`。

> 注意：Cytoscape 的 `dblclick` 既会在 node / edge 触发，也会在 core 触发。[GraphCanvas.tsx:345](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L345) 现有 `cy.on('dblclick', evt => …)` 的 `target === cy` 分支检查空白处建节点，`target.isNode()` 分支处理"扩张 focus"，对 edge 没有处理。我们加一个 `target.isEdge && target.isEdge()` 分支即可，与现有 dblclick 路由共存。

### Form 改造（[RelationForm.tsx](../../frontend/src/components/GraphEditor/RelationForm.tsx)）

当前 props：

```typescript
{
  sourceId, targetId, sourceName?, targetName?,
  onSubmit: (payload: RelationCreateInput) => …,
  onCancel
}
```

改为：

```typescript
{
  mode?: 'create' | 'edit';            // 默认 'create'
  sourceId, targetId, sourceName?, targetName?,
  initial?: {                           // edit 模式下必填
    relation_type: RelType;
    description?: string;
    confidence?: number;
    status: NodeStatus;
  };
  onSubmit: (payload: RelationCreateInput | RelationUpdatePayload) => …,
  onCancel
}
```

新增字段（仅在 `mode='edit'` 显示）：

- **置信度**：`<input type="number" step="0.05" min="0" max="1">` —— 与 NodePanel 现有 `Number(...).toFixed(2)` 显示对齐
- **状态**：`<select>` 渲染 `NodeStatus.options`（candidate / approved / rejected）
- **source / target**：始终渲染（让用户看上下文），edit 模式下纯文本不可改

提交逻辑：

- create 模式：`onSubmit({ source_id, target_id, relation_type, description, source: 'manual' })` —— 与现状一致
- edit 模式：`onSubmit({ relation_type, description, confidence, status })` —— 仅传 patch 字段；`source_id` / `target_id` 不在 patch 内（schema 也不接受）

### 后端 schema 放开（[relation.service.ts:22](../../backend/src/modules/relations/relation.service.ts#L22)）

```typescript
// before
export const RelationUpdateInput = z.object({
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: NodeStatus.optional(),
}).strict();

// after
export const RelationUpdateInput = z.object({
  relation_type: RelationType.optional(),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: NodeStatus.optional(),
}).strict();
```

[relation.service.ts](../../backend/src/modules/relations/relation.service.ts) 的两条 update 实现路径（PG @ ~423 / Neo4j @ ~408）现在已读 patch.description / patch.status / patch.confidence。补 `relation_type` 写入：

- **PG 路径**：`prisma.relation.update({ data: { ...patch, relation_type: patch.relation_type } })`，Prisma 会忽略 undefined 字段
- **Neo4j 路径**：现有 Cypher 用 `SET r.description = $description, r.status = $status` 这种 conditional set；加一行 `SET r.relation_type = coalesce($relation_type, r.relation_type)` 形式（按既有写法对齐）

> ⚠️ Neo4j 的 relation_type 是边的 label（`-[r:RELATED_TO]->`），不能直接 `SET r.relation_type`；需要 `MATCH ... DELETE r CREATE (s)-[r2:NEW_TYPE { ...props }]->(t)` 这种重建。
> **决定**：本次不动 Neo4j 路径的 relation_type。如果跑在 STORAGE_BACKEND=neo4j（已废弃路径），后端在 service 层检测：传了 `relation_type` + 后端是 neo4j → 返回 `400 { error: 'relation_type_change_unsupported_on_neo4j' }`，前端 toast 报。
> 实际上 [storage-backend.ts](../../backend/src/lib/storage-backend.ts) 默认已切到 pg，正常 dev / prod 不会触发；这是 defensive guard。

### 数据流

```
画布双击 edge
  └─ GraphCanvas: cy.on('dblclick', edge => onEditRelation(edge.id()))
  └─ GraphEditorPage: handleEditRelation(id) → setEditingRelationId(id)
  └─ Modal open → render RelationForm(mode='edit', initial=relations.find(...))
  └─ 用户改字段 → onSubmit(patch)
  └─ relationsApi.update(id, patch)
  └─ 后端 PUT /api/relations/:id → RelationService.update → DB
  └─ 200 { Relation } → upsertRelation(updated) → Zustand store 更新
  └─ Cytoscape useEffect 看到 relations 变化 → 重新 sync elements / label
  └─ Modal 关闭
```

### 错误

- 网络/校验失败 → RelationForm 内部 `setError`（已有），role="alert" 红字
- 后端 404（关系已被别人删了） → toast.error("关系已不存在") + 关闭 modal + 从 store 移除
- relation_type 在 Neo4j 后端不支持 → toast.error，保留其他字段已改的状态

### 测试

- [RelationForm.test.tsx](../../frontend/src/components/GraphEditor/__tests__/RelationForm.test.tsx) 加用例：
  - `mode='edit'` 渲染 initial 字段值
  - source / target 字段不可编辑
  - 提交 patch 不包含 `source_id` / `target_id`
  - confidence / status / relation_type 三字段 round-trip
- [relation.service.test.ts](../../backend/src/modules/relations/__tests__/) 加："update accepts relation_type"
- 不增 e2e

---

## 五、功能三：学习路径自动聚焦

### 触发链

```
NodePanel "📚 学习路径"
  → setLearningPathNodeId(nodeId)
  → LearningPathPanel useEffect 拉 learningApi.learningPath(nodeId)
  → phase='ready' && data 就绪
  → 调 props.onPathLoaded([target.node_id, ...path.map(s => s.node_id)])
  → GraphEditorPage setFocusedNodeIds(new Set([...]))
  → GraphCanvas focusedNodeIds prop 变 → 已有 useEffect 给 ring 加 .focused，其余 .dimmed
```

### LearningPathPanel 改造

新增 prop：

```typescript
onPathLoaded?: (nodeIds: string[]) => void;
```

在 `setData(res); setPhase('ready')` 之后立即调（[LearningPathPanel.tsx:42-46](../../frontend/src/components/GraphEditor/LearningPathPanel.tsx#L42-L46)）：

```typescript
.then((res) => {
  if (cancelled) return;
  setData(res);
  setPhase('ready');
  onPathLoaded?.([res.target.node_id, ...res.path.map(s => s.node_id)]);
})
```

> 不在 `useEffect [data]` 里调 — 那样会引入额外渲染依赖且在 cancelled 后还可能触发。直接在 then 里调最干净。

### GraphEditorPage 联动

```typescript
<LearningPathPanel
  nodeId={learningPathNodeId}
  onClose={() => {
    setLearningPathNodeId(null);
    handleClearFocus();        // 关闭面板 = 退出聚焦
  }}
  onPathLoaded={(ids) => setFocusedNodeIds(new Set(ids))}
  onJumpToNode={(nodeId) => {
    setLearningPathNodeId(null);
    handleEnterFocus(nodeId);  // 单节点 focus，覆盖 path focus（用户主动选择）
    selectNode(nodeId);
  }}
/>
```

### 边界与决策

1. **`phase='not_found' / 'pg_required' / 'error'` 不触发 focus** — 此时画布保持原样；用户看到错误信息但不会突然全 dim
2. **空 path 也要 focus** — 即使 `path.length === 0`，仍把 `[target]` 设为 focused，让目标节点高亮，其余 dim；这与"打开了路径面板"的语义一致
3. **关闭面板 = 清 focus** — 不维护"用户之前的 focus 历史"。这是 YAGNI 决定；如果用户原本已经 focus 了某个其他节点，关闭路径面板后回到全图（而不是恢复原 focus）。学习路径流程是显式短任务，用户能再点一下原节点恢复
4. **打开路径面板时如果用户已有 focus** — 直接覆盖。不弹确认
5. **NodeSearchBox 现有 `onSelect={handleEnterFocus}` 不变** — 跟路径 focus 是同一个 state，最后一个写入者赢

### 测试

- [LearningPathPanel.test.tsx](../../frontend/src/components/GraphEditor/__tests__/LearningPathPanel.test.tsx) 加用例："ready 后调用 onPathLoaded with [target, ...path] 顺序"
- 加 "phase=not_found 不调 onPathLoaded"
- GraphEditorPage 集成测（如果有）：打开路径面板后 `[data-testid="canvas-node-X"]` 的 `data-focus` 属性更新；关闭面板后回到 `none`

---

## 六、变更清单

### 前端

| 文件 | 改动 |
| --- | --- |
| [GraphCanvas.tsx](../../frontend/src/components/GraphEditor/GraphCanvas.tsx) | + zoomIn/zoomOut + 两按钮；+ `cy.on('dblclick', 'edge', …)` → `onEditRelation` prop |
| [RelationForm.tsx](../../frontend/src/components/GraphEditor/RelationForm.tsx) | + `mode` / `initial` props；edit 模式渲染 confidence / status / relation_type 可改，source/target 禁用；提交 payload 形态分支 |
| [GraphEditorPage.tsx](../../frontend/src/pages/GraphEditorPage.tsx) | + `editingRelationId` state + Modal + `handleEditRelation` / `handleUpdateRelation`；LearningPathPanel `onPathLoaded` 联动；`onClose` 加 `handleClearFocus` |
| [LearningPathPanel.tsx](../../frontend/src/components/GraphEditor/LearningPathPanel.tsx) | + `onPathLoaded?: (ids: string[]) => void` prop；ready 时调用 |
| 测试文件 | RelationForm.test 加 edit 用例；LearningPathPanel.test 加 onPathLoaded 用例 |

### 后端

| 文件 | 改动 |
| --- | --- |
| [relation.service.ts](../../backend/src/modules/relations/relation.service.ts) | `RelationUpdateInput` 加 `relation_type`；PG update 路径补 relation_type 字段写入；Neo4j 路径检测并报 400（defensive） |
| relation.service.test | + "update accepts relation_type" |

### 共享

无。`RelationType` / `NodeStatus` / `Relation` 已在 `@mkg/shared` 暴露。

---

## 七、不在范围

- 边的 source / target 节点交换（"调头"或"接到别的节点上"）— 改一条边的端点等于业务上不同的边
- 关系编辑历史 / audit log — 项目其他实体也不做
- 缩放百分比显示（如 "100%" 标签）— 与现有"自动布局/适应视图"风格保持简洁
- 学习路径以外的"高亮一组节点"通用 API — focus mode 已有，本次只是在路径流程里调用它
- 路径聚焦时的视觉差异化（蓝色高亮 / 标号）— 沿用现有 `.focused` / `.dimmed` 样式即可

---

## 八、实施顺序

按"独立性最高"排序，每步一个 PR / commit：

1. **缩放按钮**（最小，无后端，无风险）
2. **学习路径自动聚焦**（前端 only，机制已存在）
3. **边编辑**（涉及后端 schema + 前端表单 + Neo4j defensive guard，最大）

测试在每步内联完成，不留尾巴。
