import { useEffect, useMemo, useState } from 'react';
import type { Relation } from '@mkg/shared';
import {
  learningApi,
  nodesApi,
  relationsApi,
  type SynonymCandidate,
} from '../../api';
import { ApiError } from '../../lib/api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Button, Modal, toast } from '../ui';

interface SynonymMergePanelProps {
  open: boolean;
  graphId: string;
  /**
   * Current relations from the graph store. Used as a hint for the
   * confirmation dialog count and as a fallback if a fresh fetch fails;
   * `runMerge` re-fetches the keep node's relations before rewiring to
   * avoid stale-snapshot races.
   */
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
const THRESHOLD_DEBOUNCE_MS = 300;

/**
 * Modal that lists potential synonyms and lets reviewers merge two nodes.
 *
 * Backend RelationUpdateInput does NOT allow rewiring source_id/target_id, so
 * "merge" is implemented client-side by:
 *   1. Listing the discard node's incident relations.
 *   2. Re-creating each one against the keep node, skipping self-loops and
 *      duplicates of relations already attached to the keep node. When a
 *      duplicate exists with lower confidence, the keep node's edge is
 *      replaced with the discard's higher-confidence one.
 *   3. Deleting the discard node ONLY if every rewire succeeded — partial
 *      failures leave the discard node alone so the user can retry without
 *      losing data.
 *
 * The merge isn't atomic across HTTP calls. The page-level `onMerged`
 * callback always runs to re-sync graph state from the server.
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
  // Debounce the threshold so a slider drag doesn't fire 14+ requests.
  const debouncedThreshold = useDebouncedValue(threshold, THRESHOLD_DEBOUNCE_MS);
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
      .synonymCandidates(graphId, debouncedThreshold)
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
  }, [open, graphId, debouncedThreshold]);

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

  // Count of relations incident to the discard node — surfaced in the confirm
  // dialog so the user knows the blast radius before they click confirm.
  const pendingIncidentCount = useMemo(() => {
    if (!pending) return 0;
    return relations.filter(
      (r) => r.source_id === pending.discardId || r.target_id === pending.discardId,
    ).length;
  }, [pending, relations]);

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
      // reality before the next refresh — but only if the discard node was
      // actually deleted. On partial failure the candidate must remain so the
      // user can retry.
      if (result.deletedDiscard) {
        setCandidates((cs) =>
          cs.filter(
            (c) =>
              !(
                (c.a.node_id === pending.keepId && c.b.node_id === pending.discardId) ||
                (c.b.node_id === pending.keepId && c.a.node_id === pending.discardId)
              ),
          ),
        );
      }
      onMerged();
    } catch (err) {
      toast.error(err instanceof Error ? `合并失败：${err.message}` : '合并失败');
    } finally {
      setMerging(false);
    }
  };

  const filteredCandidates = useMemo(
    () => candidates.filter((c) => c.score >= debouncedThreshold),
    [candidates, debouncedThreshold],
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
              <strong>“{pending.keepName}”</strong>。
            </p>
            <p style={{ fontSize: 13 }} data-testid="synonym-confirm-count">
              此操作将把 <strong>{pendingIncidentCount}</strong> 条关系从
              “{pending.discardName}” 转移到 “{pending.keepName}”
              （自环 / 已存在的低置信度重复关系会被合并），随后删除“
              {pending.discardName}”。该操作不可撤销。
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
  /** Skipped because target was already a duplicate (or self-loop). */
  skipped: number;
  /**
   * Number of keep-side edges replaced by a higher-confidence discard edge.
   * Counted separately from `rewired` because the operation is delete + create.
   */
  replaced: number;
  errors: string[];
  /**
   * True iff the discard node was actually deleted. False on any partial
   * failure — the caller uses this to keep the candidate visible for retry.
   */
  deletedDiscard: boolean;
}

interface DedupSlot {
  /** relation_id of the existing keep-side edge, used to delete on replace. */
  relationId?: string;
  confidence: number;
}

/**
 * Build a `(otherEnd, relation_type) → {relationId, confidence}` map of
 * relations already incident to `keepId`. Used by `runMerge` to detect
 * collisions and to delete the loser when discard's edge wins.
 */
function indexKeepRelations(
  rels: Relation[],
  keepId: string,
): { out: Map<string, DedupSlot>; in: Map<string, DedupSlot> } {
  const out = new Map<string, DedupSlot>();
  const inMap = new Map<string, DedupSlot>();
  for (const r of rels) {
    const conf = typeof r.confidence === 'number' ? r.confidence : 1;
    const slot: DedupSlot =
      r.relation_id !== undefined
        ? { relationId: r.relation_id, confidence: conf }
        : { confidence: conf };
    if (r.source_id === keepId) {
      const sig = `${r.target_id}::${r.relation_type}`;
      out.set(sig, slot);
    }
    if (r.target_id === keepId) {
      const sig = `${r.source_id}::${r.relation_type}`;
      inMap.set(sig, slot);
    }
  }
  return { out, in: inMap };
}

/**
 * Exported for unit tests so the rewire bookkeeping can be verified
 * independently of the React layer.
 *
 * Behavior:
 *   - Refetches all relations (to pick up edges that landed between the
 *     candidate list render and the confirm click), then partitions them
 *     into "incident to discard" and "already on keep".
 *   - For each discard edge, computes (otherEnd, relation_type). If keep has
 *     no collision: create. If collision and discard's confidence > keep's:
 *     delete keep's edge, create discard's. If collision and confidence
 *     ≤ keep's: skip.
 *   - Preserves status + source on the recreated edge (audit trail).
 *   - Deletes the discard node ONLY when every rewire succeeded.
 */
export async function runMerge(
  graphId: string,
  pending: PendingMerge,
  fallbackRelations: Relation[],
): Promise<MergeResult> {
  const { keepId, discardId } = pending;
  const result: MergeResult = {
    rewired: 0,
    skipped: 0,
    replaced: 0,
    errors: [],
    deletedDiscard: false,
  };

  // Fresh-fetch relations so we don't rewire against a stale snapshot.
  // If the fetch fails we fall back to the prop snapshot rather than
  // bail out — partial info beats no merge.
  let relations = fallbackRelations;
  try {
    relations = await relationsApi.list(graphId);
  } catch {
    // Keep fallback; the dedup map will be slightly stale but the merge
    // is still better than refusing the user's action.
  }

  const keepIndex = indexKeepRelations(relations, keepId);

  // Discard node's incident relations.
  const incident = relations.filter(
    (r) => r.source_id === discardId || r.target_id === discardId,
  );

  for (const r of incident) {
    const isOutgoing = r.source_id === discardId;
    const otherEnd = isOutgoing ? r.target_id : r.source_id;

    // Self-loop (relation was between keep and discard) — nothing to rewire.
    if (otherEnd === keepId) {
      result.skipped += 1;
      continue;
    }

    const sig = `${otherEnd}::${r.relation_type}`;
    const sideMap = isOutgoing ? keepIndex.out : keepIndex.in;
    const collision = sideMap.get(sig);
    const discardConf = typeof r.confidence === 'number' ? r.confidence : 1;

    // Collision at lower-or-equal confidence: keep wins, skip.
    if (collision && discardConf <= collision.confidence) {
      result.skipped += 1;
      continue;
    }

    // Collision at higher confidence: delete the keep-side edge first so
    // the create doesn't fail on a unique constraint (PG) or merge-update
    // a property by surprise (Neo4j).
    if (collision && collision.relationId) {
      try {
        await relationsApi.remove(collision.relationId);
      } catch (err) {
        result.errors.push(
          err instanceof Error ? err.message : 'unknown remove-collision error',
        );
        // If we can't delete the loser we must skip the create — otherwise
        // we'd risk a duplicate on success.
        continue;
      }
    }

    try {
      await relationsApi.create(graphId, {
        source_id: isOutgoing ? keepId : otherEnd,
        target_id: isOutgoing ? otherEnd : keepId,
        relation_type: r.relation_type,
        description: r.description,
        confidence: discardConf,
        // Preserve audit trail. Backend defaults remain in place when these
        // are undefined.
        status: r.status,
        source: r.source,
      });
      sideMap.set(sig, { confidence: discardConf });
      if (collision) {
        result.replaced += 1;
      } else {
        result.rewired += 1;
      }
    } catch (err) {
      result.errors.push(
        err instanceof Error ? err.message : 'unknown rewire error',
      );
    }
  }

  // B1: only delete the discard node if every rewire succeeded. Otherwise
  // leave it so the user can retry without losing data.
  if (result.errors.length > 0) {
    return result;
  }

  try {
    await nodesApi.remove(discardId);
    result.deletedDiscard = true;
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
    const replaced = r.replaced > 0 ? `，替换 ${r.replaced} 条更高置信度关系` : '';
    return `合并完成：转移 ${r.rewired} 条关系，跳过 ${r.skipped} 条（重复或自环）${replaced}。`;
  }
  return `合并部分完成：转移 ${r.rewired}，替换 ${r.replaced}，跳过 ${r.skipped}，失败 ${r.errors.length}。被丢弃节点已保留，请修复失败项后重试或手动删除。`;
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
