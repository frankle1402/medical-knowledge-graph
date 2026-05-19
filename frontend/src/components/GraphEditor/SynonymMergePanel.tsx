import { useEffect, useMemo, useState } from 'react';
import type { Relation } from '@mkg/shared';
import {
  learningApi,
  nodesApi,
  relationsApi,
  type SynonymCandidate,
} from '../../api';
import { ApiError } from '../../lib/api';
import { Button, Modal, toast } from '../ui';

interface SynonymMergePanelProps {
  open: boolean;
  graphId: string;
  /** Current relations from the graph store; used for client-side dedup. */
  relations: Relation[];
  onClose: () => void;
  /** Called after a successful merge so the page can refetch its graph state. */
  onMerged: () => void;
}

type Phase = 'idle' | 'loading' | 'ready' | 'embeddings_not_ready' | 'error';

interface PendingMerge {
  candidate: SynonymCandidate;
  keepId: string;
  discardId: string;
  keepName: string;
  discardName: string;
}

const DEFAULT_THRESHOLD = 0.92;

/**
 * Modal that lists potential synonyms and lets reviewers merge two nodes.
 *
 * Backend RelationUpdateInput does NOT allow rewiring source_id/target_id, so
 * "merge" is implemented client-side by:
 *   1. Listing the discard node's incident relations.
 *   2. Re-creating each one against the keep node, skipping self-loops and
 *      duplicates of relations already attached to the keep node.
 *   3. Deleting the discard node — the backend cascades the old relations.
 *
 * The merge isn't atomic across HTTP calls, so partial failures surface in
 * the toast. The page-level `onMerged` callback always runs to re-sync graph
 * state from the server.
 */
export function SynonymMergePanel({
  open,
  graphId,
  relations,
  onClose,
  onMerged,
}: SynonymMergePanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [candidates, setCandidates] = useState<SynonymCandidate[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setErrorMsg(null);
    learningApi
      .synonymCandidates(graphId, threshold)
      .then((res) => {
        if (cancelled) return;
        setCandidates(res.candidates);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 503) {
          setPhase('embeddings_not_ready');
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, graphId, threshold]);

  const handleStartMerge = (
    candidate: SynonymCandidate,
    keepId: string,
    discardId: string,
  ) => {
    if (keepId === discardId) return;
    const keepName = keepId === candidate.a.node_id ? candidate.a.name : candidate.b.name;
    const discardName =
      discardId === candidate.a.node_id ? candidate.a.name : candidate.b.name;
    setPending({ candidate, keepId, discardId, keepName, discardName });
  };

  const handleConfirmMerge = async () => {
    if (!pending) return;
    setMerging(true);
    try {
      const result = await runMerge(graphId, pending, relations);
      const summary = mergeSummary(result);
      if (result.errors.length === 0) {
        toast.success(summary);
      } else {
        toast.warning(summary);
      }
      setPending(null);
      // Optimistically drop the candidate from the list so the panel reflects
      // reality before the next refresh.
      setCandidates((cs) =>
        cs.filter(
          (c) =>
            !(
              (c.a.node_id === pending.keepId && c.b.node_id === pending.discardId) ||
              (c.b.node_id === pending.keepId && c.a.node_id === pending.discardId)
            ),
        ),
      );
      onMerged();
    } catch (err) {
      toast.error(err instanceof Error ? `合并失败：${err.message}` : '合并失败');
    } finally {
      setMerging(false);
    }
  };

  const filteredCandidates = useMemo(
    () => candidates.filter((c) => c.score >= threshold),
    [candidates, threshold],
  );

  return (
    <>
      <Modal
        open={open}
        title="同义词合并"
        onClose={onClose}
        testId="synonym-merge-panel"
      >
        <div style={{ minWidth: 480 }}>
          <div style={controlsStyle}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
            >
              相似度阈值
              <input
                type="range"
                min={0.85}
                max={0.99}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                data-testid="synonym-threshold"
                disabled={phase === 'loading'}
              />
              <span data-testid="synonym-threshold-value">
                {threshold.toFixed(2)}
              </span>
            </label>
          </div>

          {phase === 'loading' ? (
            <p style={mutedStyle} data-testid="synonym-loading">
              扫描候选中…
            </p>
          ) : null}

          {phase === 'embeddings_not_ready' ? (
            <div data-testid="synonym-embeddings-not-ready" style={hintBoxStyle}>
              <p style={{ margin: 0, fontSize: 13 }}>
                节点向量尚未就绪。请稍后重试，或联系管理员运行 embeddings 回填脚本。
              </p>
            </div>
          ) : null}

          {phase === 'error' ? (
            <p role="alert" style={{ color: '#DC2626', fontSize: 13 }}>
              {errorMsg ?? '加载失败'}
            </p>
          ) : null}

          {phase === 'ready' ? (
            filteredCandidates.length === 0 ? (
              <p style={mutedStyle} data-testid="synonym-empty">
                未找到相似度高于阈值的候选节点。
              </p>
            ) : (
              <ul data-testid="synonym-candidates" style={listStyle}>
                {filteredCandidates.map((c) => (
                  <li
                    key={`${c.a.node_id}__${c.b.node_id}`}
                    data-testid={`synonym-candidate-${c.a.node_id}-${c.b.node_id}`}
                    style={cardStyle}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <div>
                        <div style={nodeNameStyle}>{c.a.name}</div>
                        <div style={nodeIdStyle}>{c.a.node_id}</div>
                      </div>
                      <span style={scoreBadgeStyle}>{c.score.toFixed(3)}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={nodeNameStyle}>{c.b.name}</div>
                        <div style={nodeIdStyle}>{c.b.node_id}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`synonym-keep-a-${c.a.node_id}-${c.b.node_id}`}
                        onClick={() =>
                          handleStartMerge(c, c.a.node_id, c.b.node_id)
                        }
                      >
                        保留 “{c.a.name}”
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`synonym-keep-b-${c.a.node_id}-${c.b.node_id}`}
                        onClick={() =>
                          handleStartMerge(c, c.b.node_id, c.a.node_id)
                        }
                      >
                        保留 “{c.b.name}”
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </Modal>

      <Modal
        open={!!pending}
        title="确认合并"
        onClose={() => (merging ? undefined : setPending(null))}
        testId="synonym-confirm-modal"
      >
        {pending ? (
          <div style={{ minWidth: 360 }}>
            <p style={{ fontSize: 13 }}>
              将 <strong>“{pending.discardName}”</strong> 合并到{' '}
              <strong>“{pending.keepName}”</strong>。被丢弃节点的关系将转移到保留节点（自环 / 重复关系会被跳过），随后被丢弃节点会被删除。该操作不可撤销。
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button
                variant="secondary"
                onClick={() => setPending(null)}
                disabled={merging}
                data-testid="synonym-confirm-cancel"
              >
                取消
              </Button>
              <Button
                variant="danger"
                onClick={handleConfirmMerge}
                disabled={merging}
                data-testid="synonym-confirm-ok"
              >
                {merging ? '合并中…' : '确认合并'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

interface MergeResult {
  rewired: number;
  skipped: number;
  errors: string[];
}

/**
 * Exported for unit tests so the rewire bookkeeping can be verified
 * independently of the React layer.
 */
export async function runMerge(
  graphId: string,
  pending: PendingMerge,
  relations: Relation[],
): Promise<MergeResult> {
  const { keepId, discardId } = pending;

  // (target_type) signature for relations already incident to `keepId`.
  // Used to drop rewires that would create exact duplicates.
  const existingOut = new Set<string>();
  const existingIn = new Set<string>();
  for (const r of relations) {
    if (r.source_id === keepId) {
      existingOut.add(`${r.target_id}::${r.relation_type}`);
    }
    if (r.target_id === keepId) {
      existingIn.add(`${r.source_id}::${r.relation_type}`);
    }
  }

  // Discard node's incident relations.
  const incident = relations.filter(
    (r) => r.source_id === discardId || r.target_id === discardId,
  );

  const result: MergeResult = { rewired: 0, skipped: 0, errors: [] };

  for (const r of incident) {
    const isOutgoing = r.source_id === discardId;
    const otherEnd = isOutgoing ? r.target_id : r.source_id;

    // Self-loop (relation was between keep and discard) — nothing to rewire.
    if (otherEnd === keepId) {
      result.skipped += 1;
      continue;
    }

    const sig = `${otherEnd}::${r.relation_type}`;
    const dupSet = isOutgoing ? existingOut : existingIn;
    if (dupSet.has(sig)) {
      result.skipped += 1;
      continue;
    }

    try {
      await relationsApi.create(graphId, {
        source_id: isOutgoing ? keepId : otherEnd,
        target_id: isOutgoing ? otherEnd : keepId,
        relation_type: r.relation_type,
        description: r.description,
        confidence: r.confidence ?? 1,
      });
      dupSet.add(sig);
      result.rewired += 1;
    } catch (err) {
      result.errors.push(
        err instanceof Error ? err.message : 'unknown rewire error',
      );
    }
  }

  // Always try to delete the discard node, even if some rewires failed —
  // the user explicitly opted in and old relations would otherwise stick
  // around as orphan duplicates after the next refresh.
  try {
    await nodesApi.remove(discardId);
  } catch (err) {
    result.errors.push(
      err instanceof Error
        ? `删除被丢弃节点失败：${err.message}`
        : '删除被丢弃节点失败',
    );
  }

  return result;
}

function mergeSummary(r: MergeResult): string {
  if (r.errors.length === 0) {
    return `合并完成：转移 ${r.rewired} 条关系，跳过 ${r.skipped} 条（重复或自环）。`;
  }
  return `合并部分完成：转移 ${r.rewired}，跳过 ${r.skipped}，失败 ${r.errors.length}。`;
}

const controlsStyle: React.CSSProperties = {
  marginBottom: 12,
  paddingBottom: 12,
  borderBottom: '1px solid #e5e7eb',
};

const mutedStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 13,
};

const hintBoxStyle: React.CSSProperties = {
  background: '#FEF3C7',
  border: '1px solid #FDE68A',
  color: '#92400E',
  padding: 12,
  borderRadius: 6,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  maxHeight: 480,
  overflowY: 'auto',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: 12,
  marginBottom: 8,
  background: '#FAFAFA',
};

const nodeNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#111827',
};

const nodeIdStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

const scoreBadgeStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#1D4ED8',
  background: '#EFF6FF',
  padding: '4px 10px',
  borderRadius: 999,
  height: 'fit-content',
  alignSelf: 'center',
  fontVariantNumeric: 'tabular-nums',
};
