import { useEffect, useMemo, useState } from 'react';
import type { Node as KGNode, Relation } from '@mkg/shared';
import { aiApi } from '../../api';
import { Button, Modal, toast } from '../ui';
import { useGraphStore } from '../../stores';

interface ReviewPanelProps {
  open: boolean;
  jobId: string | null;
  onClose: () => void;
}

/**
 * Reviews AI-generated candidates for a single job.
 *
 * Workflow:
 *   1. Read candidate nodes/relations from the graph store, filtered by
 *      `ai_job_id === jobId` AND `status === 'candidate'`.
 *   2. User selects a subset (or none) and clicks one of:
 *      - 全部通过 → POST /api/ai/jobs/:jobId/approve-all
 *      - 通过所选 → POST /api/ai/jobs/:jobId/approve  with the selected ids
 *      - 全部驳回 → POST /api/ai/jobs/:jobId/reject-all
 *   3. After a successful response we update the store:
 *      - approved candidates → status='approved'
 *      - rejected candidates → removed from store
 */
export function ReviewPanel({ open, jobId, onClose }: ReviewPanelProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const relations = useGraphStore((s) => s.relations);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setRelations = useGraphStore((s) => s.setRelations);

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedRelationIds, setSelectedRelationIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState<null | 'approve-all' | 'approve' | 'reject-all'>(
    null,
  );

  const candidateNodes = useMemo<KGNode[]>(
    () => nodes.filter((n) => n.ai_job_id === jobId && n.status === 'candidate'),
    [nodes, jobId],
  );
  // Only relations with a server-issued id can be reviewed; locally created
  // relations without an id are skipped (they're persisted via a different path).
  const candidateRelations = useMemo<Array<Relation & { relation_id: string }>>(
    () =>
      relations.filter(
        (r): r is Relation & { relation_id: string } =>
          typeof r.relation_id === 'string' &&
          r.ai_job_id === jobId &&
          r.status === 'candidate',
      ),
    [relations, jobId],
  );

  // When the dialog opens for a different job, reset selections.
  useEffect(() => {
    setSelectedNodeIds(new Set());
    setSelectedRelationIds(new Set());
  }, [jobId, open]);

  if (!open) return null;

  const total = candidateNodes.length + candidateRelations.length;
  const selectedCount = selectedNodeIds.size + selectedRelationIds.size;

  const toggleNode = (id: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleRelation = (id: string) => {
    setSelectedRelationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    setSelectedNodeIds(new Set(candidateNodes.map((n) => n.node_id)));
    setSelectedRelationIds(new Set(candidateRelations.map((r) => r.relation_id)));
  };
  const clearSelection = () => {
    setSelectedNodeIds(new Set());
    setSelectedRelationIds(new Set());
  };

  const markApproved = (nodeIds: string[], relationIds: string[]) => {
    const nodeSet = new Set(nodeIds);
    const relSet = new Set(relationIds);
    setNodes(
      nodes.map((n) =>
        nodeSet.has(n.node_id) ? ({ ...n, status: 'approved' } as KGNode) : n,
      ),
    );
    setRelations(
      relations.map((r) =>
        r.relation_id !== undefined && relSet.has(r.relation_id)
          ? ({ ...r, status: 'approved' } as Relation)
          : r,
      ),
    );
  };

  const removeFromStore = (nodeIds: string[], relationIds: string[]) => {
    const nodeSet = new Set(nodeIds);
    const relSet = new Set(relationIds);
    setNodes(nodes.filter((n) => !nodeSet.has(n.node_id)));
    setRelations(
      relations.filter((r) => r.relation_id === undefined || !relSet.has(r.relation_id)),
    );
  };

  const handleApproveAll = async () => {
    if (!jobId) return;
    setSubmitting('approve-all');
    try {
      await aiApi.approveAll(jobId);
      const nIds = candidateNodes.map((n) => n.node_id);
      const rIds = candidateRelations.map((r) => r.relation_id);
      markApproved(nIds, rIds);
      toast.success(`已通过 ${nIds.length} 个节点 / ${rIds.length} 条关系`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '审核失败');
    } finally {
      setSubmitting(null);
    }
  };

  const handleApproveSelected = async () => {
    if (!jobId) return;
    if (selectedCount === 0) {
      toast.error('请选择要通过的候选项');
      return;
    }
    setSubmitting('approve');
    try {
      const node_ids = Array.from(selectedNodeIds);
      const relation_ids = Array.from(selectedRelationIds);
      await aiApi.approveSome(jobId, { node_ids, relation_ids });
      markApproved(node_ids, relation_ids);
      toast.success(`已通过 ${node_ids.length} 个节点 / ${relation_ids.length} 条关系`);
      // Reset selection but keep panel open in case user wants to review more later.
      clearSelection();
      // If there are no more candidates left, close.
      if (total - selectedCount === 0) {
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '审核失败');
    } finally {
      setSubmitting(null);
    }
  };

  const handleRejectAll = async () => {
    if (!jobId) return;
    if (!confirm('确定要驳回该 Job 全部候选项？此操作不可恢复。')) return;
    setSubmitting('reject-all');
    try {
      await aiApi.rejectAll(jobId);
      const nIds = candidateNodes.map((n) => n.node_id);
      const rIds = candidateRelations.map((r) => r.relation_id);
      removeFromStore(nIds, rIds);
      toast.success('已驳回全部候选项');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '审核失败');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Modal
      open
      title={`审核 AI 生成结果（Job: ${jobId ?? '-'}）`}
      onClose={onClose}
      testId="review-panel"
    >
      <div style={{ width: 640 }}>
        {total === 0 ? (
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            该 Job 当前没有待审核的候选节点或关系。
          </p>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              <span>
                共 {total} 项待审核 · 已选 {selectedCount} 项
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={selectAll}
                  disabled={!!submitting}
                >
                  全选
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                  disabled={!!submitting}
                >
                  取消选择
                </Button>
              </div>
            </div>

            {candidateNodes.length > 0 ? (
              <ReviewSection title="候选节点" testId="review-nodes-section">
                {candidateNodes.map((n) => (
                  <ReviewRow
                    key={n.node_id}
                    id={n.node_id}
                    label={n.name}
                    sub={`${n.node_type}${
                      typeof n.confidence === 'number' ? ` · 置信度 ${n.confidence.toFixed(2)}` : ''
                    }`}
                    description={n.description}
                    checked={selectedNodeIds.has(n.node_id)}
                    onToggle={() => toggleNode(n.node_id)}
                    disabled={!!submitting}
                  />
                ))}
              </ReviewSection>
            ) : null}

            {candidateRelations.length > 0 ? (
              <ReviewSection title="候选关系" testId="review-relations-section">
                {candidateRelations.map((r) => {
                  const sourceName =
                    nodes.find((n) => n.node_id === r.source_id)?.name ?? r.source_id;
                  const targetName =
                    nodes.find((n) => n.node_id === r.target_id)?.name ?? r.target_id;
                  return (
                    <ReviewRow
                      key={r.relation_id}
                      id={r.relation_id}
                      label={`${sourceName} → ${targetName}`}
                      sub={r.relation_type}
                      checked={selectedRelationIds.has(r.relation_id)}
                      onToggle={() => toggleRelation(r.relation_id)}
                      disabled={!!submitting}
                    />
                  );
                })}
              </ReviewSection>
            ) : null}
          </>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid #e5e7eb',
          }}
        >
          <Button variant="ghost" onClick={onClose} disabled={!!submitting}>
            关闭
          </Button>
          <Button
            variant="danger"
            onClick={handleRejectAll}
            disabled={!!submitting || total === 0}
            data-testid="review-reject-all"
          >
            {submitting === 'reject-all' ? '驳回中…' : '全部驳回'}
          </Button>
          <Button
            variant="secondary"
            onClick={handleApproveSelected}
            disabled={!!submitting || selectedCount === 0}
            data-testid="review-approve-selected"
          >
            {submitting === 'approve' ? '通过中…' : `通过所选 (${selectedCount})`}
          </Button>
          <Button
            onClick={handleApproveAll}
            disabled={!!submitting || total === 0}
            data-testid="review-approve-all"
          >
            {submitting === 'approve-all' ? '通过中…' : '全部通过'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} style={{ marginBottom: 12 }}>
      <h4 style={{ margin: '8px 0 6px', fontSize: 12, color: '#374151', fontWeight: 600 }}>
        {title}
      </h4>
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: '#fafafa',
          maxHeight: 220,
          overflow: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface ReviewRowProps {
  id: string;
  label: string;
  sub?: string;
  description?: string | undefined;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function ReviewRow({ id, label, sub, description, checked, onToggle, disabled }: ReviewRowProps) {
  return (
    <label
      data-testid={`review-row-${id}`}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '8px 12px',
        borderTop: '1px solid #f3f4f6',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        aria-label={`选择:${label}`}
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        style={{ marginTop: 3 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{label}</div>
        {sub ? <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub}</div> : null}
        {description ? (
          <div
            style={{
              fontSize: 12,
              color: '#6b7280',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
    </label>
  );
}
