import { useMemo, useState } from 'react';
import type { Node as KGNode } from '@mkg/shared';
import { searchApi, type SearchMatch } from '../../api';
import { ApiError } from '../../lib/api';
import { toast } from '../ui';
import { NODE_TYPE_LABELS } from './nodeColors';

interface NodeSearchBoxProps {
  nodes: KGNode[];
  onSelect: (nodeId: string) => void;
  /** When provided, enables the semantic-mode toggle. */
  graphId?: string;
}

const MAX_SUGGESTIONS = 8;

export function NodeSearchBox({ nodes, onSelect, graphId }: NodeSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [isSemantic, setIsSemantic] = useState(false);
  const [semanticMatches, setSemanticMatches] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);

  const lexicalMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: KGNode[] = [];
    for (const n of nodes) {
      if (n.name.toLowerCase().includes(q)) {
        out.push(n);
        if (out.length >= MAX_SUGGESTIONS) break;
      }
    }
    return out;
  }, [nodes, query]);

  const handlePick = (nodeId: string) => {
    onSelect(nodeId);
    setQuery('');
    setSemanticMatches([]);
    setIsSemantic(false);
    setOpen(false);
  };

  const handleSemantic = async () => {
    const q = query.trim();
    if (!q || !graphId) return;
    setLoading(true);
    try {
      const res = await searchApi.semantic(graphId, q, MAX_SUGGESTIONS, false);
      setSemanticMatches(res.matches);
      setIsSemantic(true);
      setOpen(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error('OpenAI 暂时不可用，请稍后再试');
      } else {
        toast.error(err instanceof Error ? `语义搜索失败：${err.message}` : '语义搜索失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setOpen(true);
    if (isSemantic) {
      // Typing again means user wants fresh results — fall back to substring
      // mode so they don't keep seeing the stale semantic list.
      setIsSemantic(false);
      setSemanticMatches([]);
    }
  };

  return (
    <div style={wrapperStyle} data-testid="node-search-box">
      <div style={rowStyle}>
        <input
          type="text"
          value={query}
          placeholder="搜索节点（聚焦查看其关联）"
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          // delay so onMouseDown on a list item still fires
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && graphId) {
              e.preventDefault();
              void handleSemantic();
            }
          }}
          data-testid="node-search-input"
          style={inputStyle}
        />
        {graphId ? (
          <button
            type="button"
            onClick={() => void handleSemantic()}
            disabled={!query.trim() || loading}
            data-testid="semantic-search-btn"
            title="语义搜索（基于 embedding）"
            style={{
              ...semanticBtnStyle,
              opacity: !query.trim() || loading ? 0.5 : 1,
              cursor: !query.trim() || loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : '🔍 语义'}
          </button>
        ) : null}
      </div>
      {open && isSemantic && semanticMatches.length > 0 ? (
        <ul data-testid="node-search-results" data-mode="semantic" style={listStyle}>
          <li style={badgeStyle} data-testid="semantic-badge">
            语义搜索结果（按相似度排序）
          </li>
          {semanticMatches.map((m) => (
            <li
              key={m.node.node_id}
              data-testid={`node-search-result-${m.node.node_id}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handlePick(m.node.node_id);
              }}
              style={itemStyle}
            >
              <span style={nameStyle}>{m.node.name}</span>
              <span style={scoreStyle} data-testid={`semantic-score-${m.node.node_id}`}>
                {m.score.toFixed(2)}
              </span>
              <span style={typeStyle}>{NODE_TYPE_LABELS[m.node.node_type as keyof typeof NODE_TYPE_LABELS] ?? m.node.node_type}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open && !isSemantic && lexicalMatches.length > 0 ? (
        <ul data-testid="node-search-results" data-mode="lexical" style={listStyle}>
          {lexicalMatches.map((n) => (
            <li
              key={n.node_id}
              data-testid={`node-search-result-${n.node_id}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handlePick(n.node_id);
              }}
              style={itemStyle}
            >
              <span style={nameStyle}>{n.name}</span>
              <span style={typeStyle}>{NODE_TYPE_LABELS[n.node_type]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'stretch',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
  boxSizing: 'border-box',
};

const semanticBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#F3F4F6',
  color: '#111827',
  whiteSpace: 'nowrap',
};

const listStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: 2,
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  listStyle: 'none',
  padding: 4,
  maxHeight: 240,
  overflowY: 'auto',
  zIndex: 10,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#2563EB',
  padding: '4px 8px',
  background: '#EFF6FF',
  borderRadius: 4,
  marginBottom: 4,
};

const itemStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 13,
  cursor: 'pointer',
  borderRadius: 4,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};

const nameStyle: React.CSSProperties = {
  color: '#111827',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

const scoreStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#2563EB',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

const typeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  flexShrink: 0,
};
