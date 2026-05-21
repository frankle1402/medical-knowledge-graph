# Graph Editor: Zoom Buttons + Edge Edit + Learning Path Focus — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three independent UX improvements to the graph editor at [/graphs/:id](../../frontend/src/pages/GraphEditorPage.tsx): manual `+`/`−` zoom buttons, double-click-edge-to-edit dialog, and auto-focus mode when the learning path panel opens.

**Architecture:** Pure-frontend feature work that reuses existing primitives — Cytoscape `cy.zoom()`, the existing RelationForm + Modal, and the already-present multi-node `focusedNodeIds` focus mode. The only backend change is widening the `RelationUpdateInput` zod schema to accept `relation_type` (the PG `prisma.relation.update` call already passes through whatever fields are in the patch, so no service-body change is needed beyond a guard against the reserved `BELONGS_TO_GRAPH` type).

**Tech Stack:** React 18 + Vite, Cytoscape.js with `cytoscape-edgehandles`, Zustand store, Vitest + React Testing Library, Express + Prisma 5 + zod 3, PostgreSQL 16.

**Reference design:** [docs/plans/2026-05-21-graph-editor-zoom-edge-edit-path-focus-design.md](2026-05-21-graph-editor-zoom-edge-edit-path-focus-design.md) (commit `f148a38`).

---

## Background a fresh engineer needs

- **Storage backend**: this repo dual-supports Postgres (active) and Neo4j (legacy). [backend/.env](../../backend/.env) is set to `STORAGE_BACKEND=pg`. Service code branches on [getStorageBackend()](../../backend/src/lib/storage-backend.ts). For this plan, **only the PG path needs to handle `relation_type` updates**. The Neo4j path is locked out via a service-layer guard.
- **Relation types**: 16 enum values declared in [shared/src/enums.ts:43](../../shared/src/enums.ts). `BELONGS_TO_GRAPH` is reserved for system-internal edges and **must be rejected on both create and update** at the service layer (mirror of the existing create-time check at [relation.service.ts:62](../../backend/src/modules/relations/relation.service.ts#L62)).
- **Focus mode**: `focusedNodeIds: ReadonlySet<string>` is already wired through GraphCanvas — when non-empty, the closed 1-hop neighborhood gets the `.focused` class and everything else gets `.dimmed`. We just need to populate the set with `[target, ...path]` when the learning panel finishes loading. See [GraphCanvas.tsx:434-448](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L434-L448) for the implementation.
- **Tests**: Frontend uses Vitest, run from `frontend/`. Backend uses Vitest, run from `backend/`. Both have `__tests__` co-located folders. The repo lints on commit, but use `--no-verify` if a hook misfires; commits should still pass `npm run lint` + `npm run typecheck` per package.
- **Pre-existing uncommitted changes**: the working tree already has unrelated mods (embedding config, `start.bat` cleanup, etc). **Do not touch those files** while implementing this plan. Stage only the files you create/modify per task.

---

## Task list (independent, ordered by risk)

1. Tasks 1–3 — Feature 1: Zoom buttons (frontend only)
2. Tasks 4–7 — Feature 3: Learning path auto-focus (frontend only)
3. Tasks 8–14 — Feature 2: Edge edit dialog (backend zod + frontend form + page wiring)

Each feature lands as its own commit. Within a feature, follow TDD: failing test → minimal impl → passing test → commit.

---

# FEATURE 1 — Zoom buttons

## Task 1: Add `data-testid` hooks to existing controls (preparation)

**Files:**
- Modify: `frontend/src/components/GraphEditor/GraphCanvas.tsx:497-502`

**Step 1: Read the current control bar**

The two existing buttons live around line 497–502 of [GraphCanvas.tsx](../../frontend/src/components/GraphEditor/GraphCanvas.tsx). They have no `data-testid` today.

**Step 2: Add `data-testid` so the new tests can locate the toolbar deterministically**

```tsx
<button type="button" onClick={runLayout} style={ctrlBtnStyle} title="重新布局" data-testid="canvas-auto-layout">
  自动布局
</button>
<button type="button" onClick={fitView} style={ctrlBtnStyle} title="适应视图" data-testid="canvas-fit-view">
  适应视图
</button>
```

**Step 3: Verify nothing broke**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors.

**Step 4: No commit yet** — Task 1 is just a tiny prep edit; it commits together with Task 3.

---

## Task 2: Write failing test for zoom buttons

**Files:**
- Create: `frontend/src/components/GraphEditor/__tests__/GraphCanvas.zoom.test.tsx`

**Step 1: Write the test**

The Cytoscape instance is hard to fully exercise in jsdom (no real layout), but the buttons themselves and their click handlers are testable. We assert the buttons exist, are reachable by `data-testid`, and that clicking them does not throw. We do **not** assert post-zoom numeric state — that requires a real renderer.

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphCanvas } from '../GraphCanvas';

describe('GraphCanvas zoom buttons', () => {
  const noop = () => {};
  const baseProps = {
    nodes: [],
    relations: [],
    positions: {},
    onSelectNode: noop,
    onSelectRelation: noop,
    onCanvasDoubleClick: noop,
    onConnect: noop,
    onPositionChange: noop,
    onEditRelation: noop,
  };

  it('renders + and − buttons next to the existing toolbar', () => {
    render(<GraphCanvas {...baseProps} />);
    expect(screen.getByTestId('canvas-auto-layout')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-fit-view')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-zoom-in')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-zoom-out')).toBeInTheDocument();
  });

  it('clicking + does not throw even before cytoscape mounts', async () => {
    render(<GraphCanvas {...baseProps} />);
    await userEvent.click(screen.getByTestId('canvas-zoom-in'));
    await userEvent.click(screen.getByTestId('canvas-zoom-out'));
    // No assertion needed — the test passes if no error is thrown.
  });
});
```

> **Note on `onEditRelation`**: this prop is added in Task 8. For now, accept that this test file references it; the prop will exist by the time CI runs the full suite. Until then, you can keep it as `noop` — TS will complain only if the test runs before Task 8 lands. **If TS is unhappy, skip Task 2 entirely and merge it into Task 9 (run zoom tests + edge-edit tests together)**. Document the choice in the commit message.

**Step 2: Run the test, expect failure**

```bash
cd frontend && npm run test -- src/components/GraphEditor/__tests__/GraphCanvas.zoom.test.tsx
```

Expected: FAIL — `Unable to find an element by: [data-testid="canvas-zoom-in"]`.

---

## Task 3: Implement zoom buttons + handlers

**Files:**
- Modify: `frontend/src/components/GraphEditor/GraphCanvas.tsx` (around lines 484–503)

**Step 1: Add `zoomBy` helper next to `fitView`**

Right after `fitView` definition (line 484–486):

```tsx
const zoomBy = (factor: number) => {
  const cy = cyRef.current;
  if (!cy) return;
  const container = cy.container();
  const w = container?.clientWidth ?? 0;
  const h = container?.clientHeight ?? 0;
  cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: w / 2, y: h / 2 } });
};
```

**Step 2: Add the two buttons after "适应视图"**

Inside `floatingControlsStyle` div (line 496), append:

```tsx
<button type="button" onClick={() => zoomBy(1.2)} style={ctrlBtnIconStyle} title="放大" data-testid="canvas-zoom-in" aria-label="放大">
  +
</button>
<button type="button" onClick={() => zoomBy(1 / 1.2)} style={ctrlBtnIconStyle} title="缩小" data-testid="canvas-zoom-out" aria-label="缩小">
  −
</button>
```

**Step 3: Add the icon-button style**

After `ctrlBtnStyle` definition near line 538:

```tsx
const ctrlBtnIconStyle: React.CSSProperties = {
  ...ctrlBtnStyle,
  padding: '6px 10px',
  fontSize: 14,
  fontWeight: 600,
  minWidth: 30,
};
```

**Step 4: Run tests**

```bash
cd frontend && npm run test -- src/components/GraphEditor/__tests__/GraphCanvas.zoom.test.tsx
```

Expected: PASS (2 tests).

**Step 5: Type-check + lint**

```bash
cd frontend && npm run typecheck && npm run lint
```

Expected: clean.

**Step 6: Commit**

```bash
git add frontend/src/components/GraphEditor/GraphCanvas.tsx frontend/src/components/GraphEditor/__tests__/GraphCanvas.zoom.test.tsx
git commit -m "feat(graph-editor): add +/- zoom buttons to canvas toolbar"
```

---

# FEATURE 3 — Learning path auto-focus

## Task 4: Write failing test for `onPathLoaded` callback

**Files:**
- Modify: `frontend/src/components/GraphEditor/__tests__/LearningPathPanel.test.tsx`

**Step 1: Append a new `it()` block at the end of the existing `describe`**

```tsx
it('calls onPathLoaded with [target, ...path] node ids once data resolves', async () => {
  vi.spyOn(learningApi, 'learningPath').mockResolvedValue(samplePath);
  const onPathLoaded = vi.fn();
  render(
    <LearningPathPanel
      nodeId="KP_target"
      onClose={() => {}}
      onJumpToNode={() => {}}
      onPathLoaded={onPathLoaded}
    />,
  );
  await screen.findByTestId('learning-path-list');
  expect(onPathLoaded).toHaveBeenCalledTimes(1);
  expect(onPathLoaded).toHaveBeenCalledWith(['KP_target', 'KP_a', 'KP_b', 'KP_c']);
});

it('does not call onPathLoaded on 404', async () => {
  vi.spyOn(learningApi, 'learningPath').mockRejectedValue(
    new ApiError('node_not_found', 404, 'node_not_found'),
  );
  const onPathLoaded = vi.fn();
  render(
    <LearningPathPanel
      nodeId="missing"
      onClose={() => {}}
      onJumpToNode={() => {}}
      onPathLoaded={onPathLoaded}
    />,
  );
  await screen.findByTestId('learning-path-not-found');
  expect(onPathLoaded).not.toHaveBeenCalled();
});

it('still calls onPathLoaded with [target] when path is empty', async () => {
  vi.spyOn(learningApi, 'learningPath').mockResolvedValue({
    target: { node_id: 'leaf', name: '入门' },
    path: [],
  });
  const onPathLoaded = vi.fn();
  render(
    <LearningPathPanel
      nodeId="leaf"
      onClose={() => {}}
      onJumpToNode={() => {}}
      onPathLoaded={onPathLoaded}
    />,
  );
  await screen.findByTestId('learning-path-empty');
  expect(onPathLoaded).toHaveBeenCalledWith(['leaf']);
});
```

**Step 2: Run, expect failure**

```bash
cd frontend && npm run test -- src/components/GraphEditor/__tests__/LearningPathPanel.test.tsx
```

Expected: FAIL — `onPathLoaded` is not a known prop / not called.

---

## Task 5: Add `onPathLoaded` prop to LearningPathPanel

**Files:**
- Modify: `frontend/src/components/GraphEditor/LearningPathPanel.tsx`

**Step 1: Extend the props interface (around line 6–12)**

```tsx
interface LearningPathPanelProps {
  nodeId: string | null;
  onClose: () => void;
  onJumpToNode: (nodeId: string) => void;
  /** Fired once after `learningPath` resolves successfully. The argument is
   *  `[target.node_id, ...path[].node_id]` in render order so the parent can
   *  pass it directly to a focus-mode setter. Not called on 404 / errors. */
  onPathLoaded?: (nodeIds: string[]) => void;
}
```

**Step 2: Destructure the new prop in the component (around line 24)**

```tsx
export function LearningPathPanel({
  nodeId,
  onClose,
  onJumpToNode,
  onPathLoaded,
}: LearningPathPanelProps) {
```

**Step 3: Call it in the success branch of the fetch effect (around line 42–46)**

```tsx
.then((res) => {
  if (cancelled) return;
  setData(res);
  setPhase('ready');
  onPathLoaded?.([res.target.node_id, ...res.path.map((s) => s.node_id)]);
})
```

> Why call it in the `.then` and not in a separate `useEffect[data]`: the existing fetch already has a `cancelled` guard that prevents stale callbacks; piggybacking on that avoids a second effect with its own dependency-list pitfalls.

**Step 4: Run the tests**

```bash
cd frontend && npm run test -- src/components/GraphEditor/__tests__/LearningPathPanel.test.tsx
```

Expected: ALL PASS (the existing 8 tests + 3 new ones).

**Step 5: Commit**

```bash
git add frontend/src/components/GraphEditor/LearningPathPanel.tsx frontend/src/components/GraphEditor/__tests__/LearningPathPanel.test.tsx
git commit -m "feat(learning-path): expose onPathLoaded callback for focus integration"
```

---

## Task 6: Wire `onPathLoaded` to GraphEditorPage focus state

**Files:**
- Modify: `frontend/src/pages/GraphEditorPage.tsx` (around lines 320–329)

**Step 1: Locate the existing `<LearningPathPanel … />` usage near line 321**

Current code:

```tsx
<LearningPathPanel
  nodeId={learningPathNodeId}
  onClose={() => setLearningPathNodeId(null)}
  onJumpToNode={(nodeId) => {
    setLearningPathNodeId(null);
    handleEnterFocus(nodeId);
    selectNode(nodeId);
  }}
/>
```

**Step 2: Add `onPathLoaded` and chain `handleClearFocus` into `onClose`**

```tsx
<LearningPathPanel
  nodeId={learningPathNodeId}
  onClose={() => {
    setLearningPathNodeId(null);
    handleClearFocus();
  }}
  onPathLoaded={(ids) => setFocusedNodeIds(new Set(ids))}
  onJumpToNode={(nodeId) => {
    setLearningPathNodeId(null);
    handleEnterFocus(nodeId);
    selectNode(nodeId);
  }}
/>
```

> **Subtle point**: `handleClearFocus` already sets `focusedNodeIds` to a new empty Set; calling it on `onClose` cleans up regardless of whether the user reached `phase=ready` or bailed early.

**Step 3: Type-check**

```bash
cd frontend && npm run typecheck
```

Expected: clean.

**Step 4: Manual smoke (cannot fully automate without e2e)**

If a backend is running, open `/graphs/<some-id>`, click a node with prerequisites → "📚 学习路径" → confirm:
1. Target + all prereq nodes have visible (non-dimmed) styling on the canvas
2. Other nodes are dimmed
3. Closing the panel restores everything
4. Clicking a step inside the panel narrows focus to just that node

If you cannot run the full stack, **note this in the commit message** ("manual verification deferred to integration").

---

## Task 7: Commit GraphEditorPage wiring

**Step 1: Stage and commit**

```bash
git add frontend/src/pages/GraphEditorPage.tsx
git commit -m "feat(graph-editor): auto-focus path nodes when learning panel opens"
```

---

# FEATURE 2 — Double-click edge to edit

## Task 8: Backend — extend `RelationUpdateInput` (failing test)

**Files:**
- Modify: `backend/src/modules/relations/__tests__/relation.service.test.ts` (around line 87, after the existing `update mutates description / confidence` test)

**Step 1: Write three new tests after the existing update test**

```ts
it('update mutates relation_type', async () => {
  const r = await RelationService.create(graphId, {
    source_id: aId,
    target_id: bId,
    relation_type: 'RELATED_TO',
  });
  const updated = await RelationService.update(r.relation_id, {
    relation_type: 'PREREQUISITE_OF',
  });
  expect(updated?.relation_type).toBe('PREREQUISITE_OF');
});

it('update rejects relation_type BELONGS_TO_GRAPH', async () => {
  const r = await RelationService.create(graphId, {
    source_id: aId,
    target_id: bId,
    relation_type: 'RELATED_TO',
  });
  await expect(
    RelationService.update(r.relation_id, {
      relation_type: 'BELONGS_TO_GRAPH' as any,
    }),
  ).rejects.toThrow(/BELONGS_TO_GRAPH/);
});

it('update accepts status + confidence + relation_type together', async () => {
  const r = await RelationService.create(graphId, {
    source_id: aId,
    target_id: bId,
    relation_type: 'RELATED_TO',
  });
  const updated = await RelationService.update(r.relation_id, {
    relation_type: 'EASILY_CONFUSED_WITH',
    confidence: 0.7,
    status: 'approved',
    description: 'reviewed',
  });
  expect(updated?.relation_type).toBe('EASILY_CONFUSED_WITH');
  expect(updated?.confidence).toBe(0.7);
  expect(updated?.status).toBe('approved');
  expect(updated?.description).toBe('reviewed');
});
```

**Step 2: Run, expect failure**

```bash
cd backend && npm run test -- src/modules/relations/__tests__/relation.service.test.ts
```

Expected: FAIL on the first new test — `RelationUpdateInput` strict schema rejects `relation_type`.

---

## Task 9: Backend — implement schema + guard

**Files:**
- Modify: `backend/src/modules/relations/relation.service.ts:22-29` (zod schema)
- Modify: `backend/src/modules/relations/relation.service.ts:406-440` (PG `update` body — add the BELONGS_TO_GRAPH guard)

**Step 1: Widen `RelationUpdateInput`**

```ts
export const RelationUpdateInput = z
  .object({
    relation_type: RelationType.optional(),
    description: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: NodeStatus.optional(),
  })
  .strict();
```

`RelationType` is already imported at [relation.service.ts:6](../../backend/src/modules/relations/relation.service.ts#L6).

**Step 2: Add the BELONGS_TO_GRAPH guard at the top of the PG `update` method**

Insert right after the `relation_id` regex check (around line 412):

```ts
if (patch.relation_type === 'BELONGS_TO_GRAPH') {
  throw Object.assign(new Error('BELONGS_TO_GRAPH is reserved'), {
    statusCode: 400,
  });
}
```

> The PG `prisma.relation.update({ data: cleaned })` call **already** writes through whatever fields are in `cleaned`. Because zod now allows `relation_type`, it lands in `cleaned`, and Prisma persists it. **No further service-body change needed.**

**Step 3: Add a Neo4j-path guard if `getStorageBackend() === 'neo4j'`**

The Neo4j legacy path lives in the same file (search for `runWriteWithMode` near line 450 if present). For the legacy update method (find it via `grep -n "async update" backend/src/modules/relations/relation.service.ts`), add at the top:

```ts
if (patch.relation_type) {
  throw Object.assign(
    new Error('relation_type changes are not supported on the Neo4j backend'),
    { statusCode: 400 },
  );
}
```

> The PG path is the active default and the test database in CI; the Neo4j guard is defensive only, since changing a Cypher edge label requires DELETE+CREATE which is out of scope.

**Step 4: Run tests**

```bash
cd backend && npm run test -- src/modules/relations/__tests__/relation.service.test.ts
```

Expected: ALL PASS.

**Step 5: Type-check + lint**

```bash
cd backend && npm run typecheck && npm run lint
```

Expected: clean.

**Step 6: Commit**

```bash
git add backend/src/modules/relations/relation.service.ts backend/src/modules/relations/__tests__/relation.service.test.ts
git commit -m "feat(relations): allow relation_type changes via PUT, ban BELONGS_TO_GRAPH"
```

---

## Task 10: Frontend — failing tests for `RelationForm` edit mode

**Files:**
- Modify: `frontend/src/components/GraphEditor/__tests__/RelationForm.test.tsx`

**Step 1: Append edit-mode tests inside the existing `describe('RelationForm', () => { ... })` block**

```tsx
it('edit mode pre-fills relation_type / description / confidence / status', () => {
  render(
    <RelationForm
      mode="edit"
      sourceId="A"
      targetId="B"
      sourceName="心率"
      targetName="血压"
      initial={{
        relation_type: 'PREREQUISITE_OF',
        description: 'because',
        confidence: 0.42,
        status: 'approved',
      }}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
  expect((screen.getByLabelText('关系类型') as HTMLSelectElement).value).toBe('PREREQUISITE_OF');
  expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe('because');
  expect((screen.getByLabelText('置信度') as HTMLInputElement).value).toBe('0.42');
  expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('approved');
});

it('edit mode submits a patch payload without source_id / target_id', async () => {
  const onSubmit = vi.fn();
  render(
    <RelationForm
      mode="edit"
      sourceId="A"
      targetId="B"
      initial={{
        relation_type: 'RELATED_TO',
        description: '',
        confidence: 1,
        status: 'candidate',
      }}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText('关系类型'), 'EASILY_CONFUSED_WITH');
  await userEvent.clear(screen.getByLabelText('置信度'));
  await userEvent.type(screen.getByLabelText('置信度'), '0.8');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const payload = onSubmit.mock.calls[0]![0];
  expect(payload).toMatchObject({
    relation_type: 'EASILY_CONFUSED_WITH',
    confidence: 0.8,
    status: 'candidate',
  });
  expect(payload).not.toHaveProperty('source_id');
  expect(payload).not.toHaveProperty('target_id');
  expect(payload).not.toHaveProperty('source');
});

it('create mode (default) still submits create payload (regression)', async () => {
  const onSubmit = vi.fn();
  render(
    <RelationForm sourceId="A" targetId="B" onSubmit={onSubmit} onCancel={() => {}} />,
  );
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    source_id: 'A',
    target_id: 'B',
    source: 'manual',
  });
});
```

**Step 2: Run, expect failure**

```bash
cd frontend && npm run test -- src/components/GraphEditor/__tests__/RelationForm.test.tsx
```

Expected: FAIL — TS error on `mode` / `initial` props or "Unable to find element by label '置信度'".

---

## Task 11: Frontend — implement `RelationForm` edit mode

**Files:**
- Modify: `frontend/src/components/GraphEditor/RelationForm.tsx` (full rewrite of the component body)

**Step 1: Replace the file with the dual-mode version**

```tsx
import { useState } from 'react';
import { RelationType, NodeStatus } from '@mkg/shared';
import type {
  RelationCreateInput,
  RelationType as RelType,
  NodeStatus as NodeStatusType,
} from '@mkg/shared';
import { RELATION_TYPE_LABELS } from './nodeColors';
import { Button } from '../ui';

export interface RelationEditPatch {
  relation_type: RelType;
  description?: string;
  confidence?: number;
  status: NodeStatusType;
}

interface CommonProps {
  sourceId: string;
  targetId: string;
  sourceName?: string | undefined;
  targetName?: string | undefined;
  onCancel: () => void;
}

interface CreateProps extends CommonProps {
  mode?: 'create';
  initial?: undefined;
  onSubmit: (payload: RelationCreateInput) => Promise<void> | void;
}

interface EditProps extends CommonProps {
  mode: 'edit';
  initial: RelationEditPatch;
  onSubmit: (payload: RelationEditPatch) => Promise<void> | void;
}

type RelationFormProps = CreateProps | EditProps;

export function RelationForm(props: RelationFormProps) {
  const { sourceId, targetId, sourceName, targetName, onCancel } = props;
  const isEdit = props.mode === 'edit';

  const [relType, setRelType] = useState<RelType>(
    isEdit ? props.initial.relation_type : 'RELATED_TO',
  );
  const [description, setDescription] = useState(isEdit ? props.initial.description ?? '' : '');
  const [confidence, setConfidence] = useState<number>(
    isEdit ? props.initial.confidence ?? 1 : 1,
  );
  const [status, setStatus] = useState<NodeStatusType>(
    isEdit ? props.initial.status : 'candidate',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isEdit) {
        const patch: RelationEditPatch = {
          relation_type: relType,
          description: description.trim() || undefined,
          confidence,
          status,
        };
        await (props as EditProps).onSubmit(patch);
      } else {
        const payload: RelationCreateInput = {
          source_id: sourceId,
          target_id: targetId,
          relation_type: relType,
          description: description.trim() || undefined,
          source: 'manual',
        };
        await (props as CreateProps).onSubmit(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label={isEdit ? '编辑关系' : '新建关系'}>
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <span style={{ color: '#6b7280' }}>从 </span>
        <strong>{sourceName ?? sourceId}</strong>
        <span style={{ color: '#6b7280' }}> 到 </span>
        <strong>{targetName ?? targetId}</strong>
        {isEdit ? (
          <span style={{ color: '#9ca3af', marginLeft: 8, fontSize: 11 }}>
            （端点不可修改）
          </span>
        ) : null}
      </div>
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
          关系类型
        </span>
        <select
          aria-label="关系类型"
          value={relType}
          onChange={(e) => setRelType(e.target.value as RelType)}
          style={selectStyle}
        >
          {RelationType.options
            .filter((t) => t !== 'BELONGS_TO_GRAPH')
            .map((t) => (
              <option key={t} value={t}>
                {RELATION_TYPE_LABELS[t]}（{t}）
              </option>
            ))}
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
          备注
        </span>
        <textarea
          aria-label="备注"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...selectStyle, resize: 'vertical' }}
        />
      </label>
      {isEdit ? (
        <>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
              置信度
            </span>
            <input
              aria-label="置信度"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              style={selectStyle}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
              状态
            </span>
            <select
              aria-label="状态"
              value={status}
              onChange={(e) => setStatus(e.target.value as NodeStatusType)}
              style={selectStyle}
            >
              {NodeStatus.options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {error ? (
        <div role="alert" style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? '提交中…' : '保存'}
        </Button>
      </div>
    </form>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};
```

**Step 2: Run tests**

```bash
cd frontend && npm run test -- src/components/GraphEditor/__tests__/RelationForm.test.tsx
```

Expected: ALL PASS (existing 2 + new 3).

**Step 3: Type-check + lint**

```bash
cd frontend && npm run typecheck && npm run lint
```

Expected: clean.

**Step 4: Commit**

```bash
git add frontend/src/components/GraphEditor/RelationForm.tsx frontend/src/components/GraphEditor/__tests__/RelationForm.test.tsx
git commit -m "feat(relation-form): add edit mode with confidence + status fields"
```

---

## Task 12: GraphCanvas — emit `onEditRelation` on edge dblclick

**Files:**
- Modify: `frontend/src/components/GraphEditor/GraphCanvas.tsx`

**Step 1: Add prop to the component's interface**

Find the props interface (around line 22 — the `relations: Relation[]` definition). Add:

```tsx
onEditRelation?: (relationId: string) => void;
```

**Step 2: Destructure it in the component (around line 48)**

```tsx
const {
  ...,
  onEditRelation,
} = props;
```

(Match the existing destructure pattern.)

**Step 3: Forward through `callbackRefs`**

The component keeps a `callbackRefs` ref to read latest callbacks inside the cytoscape event closures. Locate the ref declaration and add `onEditRelation` to it. Then in the assignment effect, set `callbackRefs.current.onEditRelation = onEditRelation`.

**Step 4: Add the dblclick handler inside the existing dblclick event listener**

The existing dblclick handler is at [GraphCanvas.tsx:345-358](../../frontend/src/components/GraphEditor/GraphCanvas.tsx#L345-L358). Add an edge branch:

```tsx
cy.on('dblclick', (evt: EventObject) => {
  if (evt.target === cy) {
    const rendered = evt.renderedPosition ?? { x: 0, y: 0 };
    callbackRefs.current.onCanvasDoubleClick({ x: rendered.x, y: rendered.y });
    return;
  }
  const target = evt.target as cytoscape.Singular;
  if (target.isEdge && target.isEdge()) {
    callbackRefs.current.onEditRelation?.(target.id());
    return;
  }
  if (target.isNode && target.isNode()) {
    const focused = focusedRef.current;
    if (focused && focused.size > 0 && !focused.has(target.id())) {
      callbackRefs.current.onExpandFocus?.(target.id());
    }
  }
});
```

**Step 5: Type-check**

```bash
cd frontend && npm run typecheck
```

Expected: clean (zoom test from Task 2 also stops complaining now if it was deferred).

**Step 6: Manual smoke later** — defer until Task 14, where the wiring is end-to-end.

**Step 7: No commit yet** — bundle with the page wiring in Task 14 as one self-contained "edge edit" commit.

---

## Task 13: Page — add modal + handlers for edit

**Files:**
- Modify: `frontend/src/pages/GraphEditorPage.tsx`

**Step 1: Add state**

Near the other `useState` hooks (around line 60–66):

```tsx
const [editingRelationId, setEditingRelationId] = useState<string | null>(null);
```

**Step 2: Compute the relation being edited**

Near `selectedRelation` (around line 118–120):

```tsx
const editingRelation = useMemo(
  () => relations.find((r) => r.relation_id === editingRelationId) ?? null,
  [relations, editingRelationId],
);
```

**Step 3: Add the update handler near `handleDeleteRelation` (around line 167–172)**

```tsx
const handleUpdateRelation = async (
  patch: import('../components/GraphEditor/RelationForm').RelationEditPatch,
) => {
  if (!editingRelation?.relation_id) return;
  try {
    const updated = await relationsApi.update(editingRelation.relation_id, patch);
    upsertRelation(updated);
    setEditingRelationId(null);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '更新关系失败');
  }
};
```

> Use `import('...')` type-only syntax to avoid an extra top-of-file import; or move to a regular import if the codebase prefers that. Match local convention.

**Step 4: Pass `onEditRelation={setEditingRelationId}` to `<GraphCanvas />`**

Find the `<GraphCanvas` JSX (around line 295–310) and add the prop.

**Step 5: Add the modal next to the existing "新建关系" Modal (around line 377–393)**

```tsx
<Modal
  open={!!editingRelation}
  title="编辑关系"
  onClose={() => setEditingRelationId(null)}
  testId="edit-relation-modal"
>
  {editingRelation ? (
    <RelationForm
      mode="edit"
      sourceId={editingRelation.source_id}
      targetId={editingRelation.target_id}
      sourceName={nodes.find((n) => n.node_id === editingRelation.source_id)?.name}
      targetName={nodes.find((n) => n.node_id === editingRelation.target_id)?.name}
      initial={{
        relation_type: editingRelation.relation_type,
        description: editingRelation.description,
        confidence: editingRelation.confidence,
        status: editingRelation.status,
      }}
      onSubmit={handleUpdateRelation}
      onCancel={() => setEditingRelationId(null)}
    />
  ) : null}
</Modal>
```

**Step 6: Type-check + lint**

```bash
cd frontend && npm run typecheck && npm run lint
```

Expected: clean.

---

## Task 14: Manual smoke + commit

**Step 1: Smoke test**

If a local stack is available:

```bash
cd "c:/ClaudeCode/20260517 TextBookRagAndKnowledgeGraph"
npm start
```

Walk the flow:
1. Open `/graphs/<id>`
2. Double-click any edge → "编辑关系" modal opens with prefilled type / description / confidence / status
3. Change relation type to a different value, click 保存
4. Modal closes, edge label on canvas updates immediately
5. Refresh the page → change persists
6. Try editing to `BELONGS_TO_GRAPH` is impossible (it's filtered out of the dropdown — confirm)

If no stack available, document the deferred verification in the commit message.

**Step 2: Commit**

```bash
git add frontend/src/components/GraphEditor/GraphCanvas.tsx frontend/src/pages/GraphEditorPage.tsx
git commit -m "feat(graph-editor): double-click edge opens edit dialog"
```

---

# Final verification

**Step 1: Run all relevant tests**

```bash
cd backend && npm run test -- src/modules/relations/
cd ../frontend && npm run test -- src/components/GraphEditor/ src/pages/
```

Expected: ALL PASS.

**Step 2: Lint + typecheck both packages**

```bash
cd backend && npm run lint && npm run typecheck
cd ../frontend && npm run lint && npm run typecheck
```

Expected: clean.

**Step 3: Confirm commit graph**

```bash
git log --oneline -10
```

Expected (in order, newest first):
- `feat(graph-editor): double-click edge opens edit dialog`
- `feat(relation-form): add edit mode with confidence + status fields`
- `feat(relations): allow relation_type changes via PUT, ban BELONGS_TO_GRAPH`
- `feat(graph-editor): auto-focus path nodes when learning panel opens`
- `feat(learning-path): expose onPathLoaded callback for focus integration`
- `feat(graph-editor): add +/- zoom buttons to canvas toolbar`
- `docs(graph-editor): design for zoom buttons / edge edit / path focus`

**Step 4: Push branch + open PR**

The current branch is `feature/pg-migration-cde-merged` (per the git status snapshot). **Do NOT push to main**. If the user wants a separate branch for this work, branch off first:

```bash
git checkout -b feature/graph-editor-zoom-edge-edit-path-focus
git push -u origin feature/graph-editor-zoom-edge-edit-path-focus
```

Then PR via `gh pr create --base main --title "Graph editor: zoom buttons, edge edit, path focus" --body "..."`.

---

## Things deliberately NOT in scope

- Edge endpoint reassignment (changing `source_id` / `target_id`)
- Audit log / change history for relation edits
- Zoom percentage display ("100%" label)
- Fancy visual differentiation for path-focus vs neighbor-focus (color-coded highlight). Reuses the existing `.focused` / `.dimmed` classes
- Neo4j path support for `relation_type` updates (defensive 400 only)

---

## Rollback strategy

Each commit is self-contained. To revert any single feature:

```bash
git revert <commit-sha>
```

The three feature commits do not depend on each other (zoom and path-focus share zero files; edge-edit modifies different files than zoom/path-focus). The design-doc commit (`f148a38`) can stay.
