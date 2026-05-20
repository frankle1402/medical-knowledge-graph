import { useEffect, useState } from 'react';
import { learningApi, type LearningPathResponse, type LearningPathStep } from '../../api';
import { ApiError } from '../../lib/api';
import { Button } from '../ui';

interface LearningPathPanelProps {
  /** Node to compute the path for. When null the panel is hidden. */
  nodeId: string | null;
  onClose: () => void;
  /** Reuse the existing focus-mode handler (handleEnterFocus). */
  onJumpToNode: (nodeId: string) => void;
}

type Phase = 'loading' | 'ready' | 'not_found' | 'pg_required' | 'error';

/**
 * Right-side drawer that lists the prerequisite chain (PREREQUISITE_OF edges)
 * for the selected node.
 *
 * Steps come back deepest-first from the backend; we render them in that
 * order so foundational concepts sit at the top and the target sits at the
 * bottom — closer to a study plan reading order.
 */
export function LearningPathPanel({ nodeId, onClose, onJumpToNode }: LearningPathPanelProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<LearningPathResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!nodeId) {
      setData(null);
      setErrorMsg(null);
      return;
    }
    let cancelled = false;
    setPhase('loading');
    setData(null);
    setErrorMsg(null);
    learningApi
      .learningPath(nodeId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setPhase('not_found');
            return;
          }
          if (err.status === 503 && err.code === 'pg_backend_required') {
            setPhase('pg_required');
            return;
          }
        }
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, reloadKey]);

  if (!nodeId) return null;

  return (
    <div data-testid="learning-path-panel" style={drawerStyle} role="dialog" aria-label="学习路径">
      <header style={headerStyle}>
        <strong style={{ fontSize: 14 }}>
          📚 {data?.target.name ? `${data.target.name} 的学习路径` : '学习路径'}
        </strong>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          data-testid="learning-path-close"
          style={closeBtnStyle}
        >
          ×
        </button>
      </header>

      <div style={bodyStyle}>
        {phase === 'loading' ? <Skeleton /> : null}

        {phase === 'not_found' ? (
          <p style={{ color: '#6b7280', fontSize: 13 }} data-testid="learning-path-not-found">
            节点未找到（可能已被删除）。
          </p>
        ) : null}

        {phase === 'pg_required' ? (
          <p
            style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}
            data-testid="learning-path-pg-required"
          >
            学习路径功能仅在 Postgres 后端下可用。
            <br />
            请在 <code>.env</code> 中设置 <code>STORAGE_BACKEND=pg</code> 并重启后端。
          </p>
        ) : null}

        {phase === 'error' ? (
          <div data-testid="learning-path-error">
            <p role="alert" style={{ color: '#DC2626', fontSize: 13 }}>
              {errorMsg ?? '加载失败'}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setReloadKey((k) => k + 1)}
              data-testid="learning-path-retry"
            >
              重试
            </Button>
          </div>
        ) : null}

        {phase === 'ready' && data ? (
          data.path.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }} data-testid="learning-path-empty">
              该节点没有标记的前置依赖。
            </p>
          ) : (
            <ol data-testid="learning-path-list" style={listStyle}>
              {data.path.map((step, idx) => (
                <PathStep key={step.node_id} step={step} index={idx} onJump={onJumpToNode} />
              ))}
              <li data-testid="learning-path-target" style={targetStyle}>
                <span style={depthStyle}>目标</span>
                <span style={{ flex: 1 }}>{data.target.name}</span>
              </li>
            </ol>
          )
        ) : null}
      </div>
    </div>
  );
}

function PathStep({
  step,
  index,
  onJump,
}: {
  step: LearningPathStep;
  index: number;
  onJump: (id: string) => void;
}) {
  return (
    <li
      data-testid={`learning-path-step-${step.node_id}`}
      data-index={index}
      style={stepStyle}
      onClick={() => onJump(step.node_id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onJump(step.node_id);
        }
      }}
    >
      <span style={depthStyle}>深度 {step.depth}</span>
      <span style={{ flex: 1 }}>{step.name}</span>
      <span style={viaStyle}>{step.via}</span>
    </li>
  );
}

function Skeleton() {
  return (
    <div data-testid="learning-path-skeleton" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 32,
            background: '#F3F4F6',
            borderRadius: 4,
            marginBottom: 8,
          }}
        />
      ))}
    </div>
  );
}

const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 48,
  right: 0,
  bottom: 0,
  width: 320,
  background: 'white',
  borderLeft: '1px solid #e5e7eb',
  boxShadow: '-4px 0 12px rgba(0,0,0,0.06)',
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 18,
  color: '#6b7280',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const stepStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  marginBottom: 8,
  cursor: 'pointer',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  background: 'white',
};

const targetStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 6,
  background: '#EFF6FF',
  color: '#1D4ED8',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  fontWeight: 500,
};

const depthStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  background: '#F3F4F6',
  padding: '2px 6px',
  borderRadius: 4,
  flexShrink: 0,
};

const viaStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#9CA3AF',
  flexShrink: 0,
};
