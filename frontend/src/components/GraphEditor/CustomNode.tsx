import { Handle, Position, type NodeProps } from 'reactflow';
import type { Node as KGNode } from '@mkg/shared';
import { APPROVED_BORDER, CANDIDATE_BORDER, NODE_COLORS, NODE_TYPE_LABELS } from './nodeColors';

export interface CustomNodeData {
  node: KGNode;
}

const handleStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  background: '#fff',
  border: '2px solid #2563eb',
  opacity: 0.9,
};

export function CustomNode({ data, selected }: NodeProps<CustomNodeData>) {
  const node = data.node;
  const fill = NODE_COLORS[node.node_type];
  const isCandidate = node.status === 'candidate';
  const border = isCandidate ? CANDIDATE_BORDER : APPROVED_BORDER;

  return (
    <div
      data-testid={`custom-node-${node.node_id}`}
      title="拖拽两侧蓝色圆点到目标节点上以建立关系"
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
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />
      <div style={{ fontWeight: 600 }}>{node.name}</div>
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
        {NODE_TYPE_LABELS[node.node_type]}
        {isCandidate ? ' · 待审核' : ''}
      </div>
    </div>
  );
}
