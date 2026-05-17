import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  AIGenerateRequest,
  AIJob,
  NodeCreateInput,
  NodeUpdateInput,
  PromptTemplate,
  RelationCreateInput,
  TemplateVariable,
} from '@mkg/shared';
import { aiApi, graphsApi, nodesApi, relationsApi, templatesApi } from '../api';
import { GraphCanvas } from '../components/GraphEditor/GraphCanvas';
import { NodeForm } from '../components/GraphEditor/NodeForm';
import { RelationForm } from '../components/GraphEditor/RelationForm';
import { NodePanel } from '../components/NodePanel';
import { ReviewPanel } from '../components/ReviewPanel';
import { Button, Modal } from '../components/ui';
import { useGraphStore } from '../stores';

export function GraphEditorPage() {
  const params = useParams<{ id: string }>();
  const graphId = params.id ?? '';
  const navigate = useNavigate();

  const {
    graph,
    nodes,
    relations,
    selectedNodeId,
    selectedRelationId,
    setGraph,
    setNodes,
    setRelations,
    upsertNode,
    upsertRelation,
    removeNode,
    removeRelation,
    selectNode,
    selectRelation,
    reset,
  } = useGraphStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createNodeOpen, setCreateNodeOpen] = useState(false);
  const [editNodeOpen, setEditNodeOpen] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{
    source: string;
    target: string;
  } | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!graphId) return;
    setLoading(true);
    setError(null);
    graphsApi
      .get(graphId)
      .then((detail) => {
        if (cancelled) return;
        setGraph(detail.graph);
        setNodes(detail.nodes);
        setRelations(detail.relations);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      reset();
    };
  }, [graphId, setGraph, setNodes, setRelations, reset]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.node_id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const selectedRelation = useMemo(
    () => relations.find((r) => r.relation_id === selectedRelationId) ?? null,
    [relations, selectedRelationId],
  );

  const handleCanvasDoubleClick = () => setCreateNodeOpen(true);
  const handleSelectNode = (id: string | null) => selectNode(id);
  const handleSelectRelation = (id: string | null) => selectRelation(id);

  const handleConnect = (source: string, target: string) => {
    setPendingConnection({ source, target });
  };

  const handleCreateNode = async (payload: NodeCreateInput | NodeUpdateInput) => {
    const created = await nodesApi.create(graphId, payload as NodeCreateInput);
    upsertNode(created);
    setCreateNodeOpen(false);
  };

  const handleUpdateNode = async (payload: NodeCreateInput | NodeUpdateInput) => {
    if (!selectedNode) return;
    const updated = await nodesApi.update(selectedNode.node_id, payload as NodeUpdateInput);
    upsertNode(updated);
    setEditNodeOpen(false);
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm('确认删除该节点及其相关关系？')) return;
    try {
      await nodesApi.remove(nodeId);
      removeNode(nodeId);
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleCreateRelation = async (payload: RelationCreateInput) => {
    const created = await relationsApi.create(graphId, payload);
    upsertRelation(created);
    setPendingConnection(null);
  };

  const handleDeleteRelation = async () => {
    if (!selectedRelation?.relation_id) return;
    if (!confirm('确认删除该关系？')) return;
    try {
      await relationsApi.remove(selectedRelation.relation_id);
      removeRelation(selectedRelation.relation_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (!graphId) {
    return <div style={{ padding: 24 }}>缺少图谱 ID</div>;
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: '#6b7280' }} role="status">
        加载图谱中…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p role="alert" style={{ color: '#DC2626' }}>
          {error}
        </p>
        <Button variant="secondary" onClick={() => navigate('/graphs')}>
          返回列表
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="graph-editor-page"
      style={{
        height: '100vh',
        display: 'grid',
        gridTemplateColumns: '240px 1fr 320px',
        gridTemplateRows: '48px 1fr',
        gridTemplateAreas: '"header header header" "left main right"',
      }}
    >
      <header
        style={{
          gridArea: 'header',
          background: 'white',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button size="sm" variant="ghost" onClick={() => navigate('/graphs')}>
            ← 返回
          </Button>
          <strong style={{ fontSize: 14 }}>{graph?.graph_name ?? graphId}</strong>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {nodes.length} 节点 · {relations.length} 关系
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setGenerateOpen(true)}>AI 生成图谱</Button>
        </div>
      </header>

      <aside
        data-testid="left-toolbar"
        style={{
          gridArea: 'left',
          background: 'white',
          borderRight: '1px solid #e5e7eb',
          padding: 12,
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 13, color: '#111827' }}>工具</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCreateNodeOpen(true)}
          style={{ width: '100%', marginBottom: 8 }}
        >
          + 新建节点
        </Button>
        <p style={{ fontSize: 11, color: '#6b7280', marginTop: 16 }}>
          双击空白处可快速新建节点；从节点边缘拖出可创建关系；选中节点后按 Delete 可删除。
        </p>
      </aside>

      <main style={{ gridArea: 'main', position: 'relative' }}>
        <GraphCanvas
          nodes={nodes}
          relations={relations}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          onSelectRelation={handleSelectRelation}
          onConnect={handleConnect}
          onDeleteNode={handleDeleteNode}
          onCanvasDoubleClick={handleCanvasDoubleClick}
          positions={positionsRef.current}
          onPositionChange={(id, pos) => positionsRef.current.set(id, pos)}
        />
      </main>

      <aside style={{ gridArea: 'right' }}>
        <NodePanel
          selectedNode={selectedNode}
          selectedRelation={selectedRelation}
          onEdit={() => setEditNodeOpen(true)}
          onDelete={() => selectedNode && handleDeleteNode(selectedNode.node_id)}
          onDeleteRelation={handleDeleteRelation}
        />
      </aside>

      <Modal
        open={createNodeOpen}
        title="新建节点"
        onClose={() => setCreateNodeOpen(false)}
        testId="create-node-modal"
      >
        <NodeForm
          mode="create"
          onSubmit={handleCreateNode}
          onCancel={() => setCreateNodeOpen(false)}
        />
      </Modal>

      <Modal
        open={editNodeOpen && !!selectedNode}
        title="编辑节点"
        onClose={() => setEditNodeOpen(false)}
        testId="edit-node-modal"
      >
        {selectedNode ? (
          <NodeForm
            mode="edit"
            initial={selectedNode}
            onSubmit={handleUpdateNode}
            onCancel={() => setEditNodeOpen(false)}
          />
        ) : null}
      </Modal>

      <Modal
        open={!!pendingConnection}
        title="新建关系"
        onClose={() => setPendingConnection(null)}
        testId="create-relation-modal"
      >
        {pendingConnection ? (
          <RelationForm
            sourceId={pendingConnection.source}
            targetId={pendingConnection.target}
            sourceName={nodes.find((n) => n.node_id === pendingConnection.source)?.name}
            targetName={nodes.find((n) => n.node_id === pendingConnection.target)?.name}
            onSubmit={handleCreateRelation}
            onCancel={() => setPendingConnection(null)}
          />
        ) : null}
      </Modal>

      <AIGenerateDialog
        open={generateOpen}
        graphId={graphId}
        onClose={() => setGenerateOpen(false)}
        onJobComplete={(job) => {
          setGenerateOpen(false);
          // Append candidate nodes/relations into store; ReviewPanel (Agent-E) will manage approval.
          if (job.output) {
            for (const n of job.output.nodes ?? []) upsertNode(n);
            for (const r of job.output.relations ?? []) upsertRelation(r);
          }
          setActiveJobId(job.job_id);
          setReviewOpen(true);
        }}
      />

      <ReviewPanel
        open={reviewOpen}
        jobId={activeJobId}
        onClose={() => setReviewOpen(false)}
      />
    </div>
  );
}

interface AIGenerateDialogProps {
  open: boolean;
  graphId: string;
  onClose: () => void;
  onJobComplete: (job: AIJob) => void;
}

function AIGenerateDialog({ open, graphId, onClose, onJobComplete }: AIGenerateDialogProps) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [variables, setVariables] = useState<Record<string, string | number | boolean>>({});
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'polling' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    templatesApi
      .list()
      .then((items) => {
        const active = items.filter((t) => t.is_active !== false);
        setTemplates(active);
        if (active.length > 0 && active[0]) setTemplateId(active[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载模板失败'));
  }, [open]);

  const currentTemplate = templates.find((t) => t.id === templateId);

  const setVar = (key: string, value: string | number | boolean) =>
    setVariables((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) {
      setError('请选择模板');
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      const req: AIGenerateRequest = {
        template_id: templateId,
        variables,
        graph_id: graphId,
      };
      const { job_id } = await aiApi.generate(req);
      setPhase('polling');
      const job = await pollJob(job_id);
      onJobComplete(job);
      setPhase('idle');
      setVariables({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
      setPhase('error');
    }
  };

  return (
    <Modal open={open} title="AI 生成图谱" onClose={onClose} testId="ai-generate-modal">
      {templates.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>暂无可用模板，请先在管理端新建模板。</p>
      ) : (
        <form onSubmit={handleSubmit} aria-label="AI 生成">
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
              提示词模板
            </span>
            <select
              aria-label="提示词模板"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setVariables({});
              }}
              style={selectStyle}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {currentTemplate?.variables.map((v) => (
            <VariableField
              key={v.key}
              variable={v}
              value={variables[v.key]}
              onChange={(val) => setVar(v.key, val)}
            />
          ))}
          {error ? (
            <div role="alert" style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>
              {error}
            </div>
          ) : null}
          {phase === 'polling' ? (
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }} role="status">
              生成中，请稍候…
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={phase === 'submitting' || phase === 'polling'}
            >
              取消
            </Button>
            <Button type="submit" disabled={phase === 'submitting' || phase === 'polling'}>
              {phase === 'polling' ? '生成中…' : phase === 'submitting' ? '提交中…' : '生成'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function VariableField({
  variable,
  value,
  onChange,
}: {
  variable: TemplateVariable;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const labelEl = (
    <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
      {variable.label}
      {variable.required ? <span style={{ color: '#DC2626' }}> *</span> : null}
    </span>
  );

  switch (variable.type) {
    case 'textarea':
      return (
        <label style={{ display: 'block', marginBottom: 12 }}>
          {labelEl}
          <textarea
            aria-label={variable.label}
            rows={3}
            placeholder={variable.placeholder}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...selectStyle, resize: 'vertical' }}
          />
        </label>
      );
    case 'select':
      return (
        <label style={{ display: 'block', marginBottom: 12 }}>
          {labelEl}
          <select
            aria-label={variable.label}
            value={(value as string) ?? variable.default ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={selectStyle}
          >
            {(variable.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );
    case 'number':
      return (
        <label style={{ display: 'block', marginBottom: 12 }}>
          {labelEl}
          <input
            aria-label={variable.label}
            type="number"
            value={(value as number | undefined) ?? ''}
            onChange={(e) => onChange(Number(e.target.value))}
            style={selectStyle}
          />
        </label>
      );
    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            aria-label={variable.label}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span style={{ fontSize: 12, color: '#374151' }}>{variable.label}</span>
        </label>
      );
    case 'text':
    default:
      return (
        <label style={{ display: 'block', marginBottom: 12 }}>
          {labelEl}
          <input
            aria-label={variable.label}
            placeholder={variable.placeholder}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={selectStyle}
          />
        </label>
      );
  }
}

async function pollJob(jobId: string, maxAttempts = 60, intervalMs = 1000): Promise<AIJob> {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await aiApi.getJob(jobId);
    if (job.status === 'success' || job.status === 'failed' || job.status === 'partial') {
      return job;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('生成超时');
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};

/**
 * Placeholder for ReviewPanel.
 *
 * ROUTE-POINTS:agent-e — replaced; the real `<ReviewPanel>` lives at
 * `frontend/src/components/ReviewPanel/ReviewPanel.tsx` and is imported above.
 */
