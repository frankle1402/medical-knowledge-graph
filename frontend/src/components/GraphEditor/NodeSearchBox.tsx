import { useMemo, useState } from 'react';
import type { Node as KGNode } from '@mkg/shared';
import { NODE_TYPE_LABELS } from './nodeColors';

interface NodeSearchBoxProps {
  nodes: KGNode[];
  onSelect: (nodeId: string) => void;
}

const MAX_SUGGESTIONS = 8;

export function NodeSearchBox({ nodes, onSelect }: NodeSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
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
    setOpen(false);
  };

  return (
    <div style={wrapperStyle} data-testid="node-search-box">
      <input
        type="text"
        value={query}
        placeholder="搜索节点（聚焦查看其关联）"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // delay so onMouseDown on a list item still fires
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        data-testid="node-search-input"
        style={inputStyle}
      />
      {open && matches.length > 0 ? (
        <ul data-testid="node-search-results" style={listStyle}>
          {matches.map((n) => (
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
  boxSizing: 'border-box',
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
};

const typeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  flexShrink: 0,
};
