import { Handle, Position, type NodeProps } from 'reactflow';
import type { Node as KGNode } from '@mkg/shared';
import { APPROVED_BORDER, CANDIDATE_BORDER, NODE_COLORS, NODE_TYPE_LABELS } from './nodeColors';

export interface CustomNodeData {
  node: KGNode;
}

export function CustomNode({ data, selected }: NodeProps<CustomNodeData>) {
  const node = data.node;
  const fill = NODE_COLORS[node.node_type];
  const isCandidate = node.status === 'candidate';
  const border = isCandidate ? CANDIDATE_BORDER : APPROVED_BORDER;

  return (
    <div
      data-testid={`custom-node-${node.node_id}`}
      style={{
        background: fill,
        color: 'white',
        padding: '8px 14px',
        borderRadius: 8,
        border,
        boxShadow: selected ? '0 0 0 3px rgba(59,130,246,.45)' : 'none',
        minWidth: 120,
        textAlign: 'center',
        fontSize: 12,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 600 }}>{node.name}</div>
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
        {NODE_TYPE_LABELS[node.node_type]}
        {isCandidate ? ' · 待审核' : ''}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
