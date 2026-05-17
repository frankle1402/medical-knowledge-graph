import { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Connection,
  type Edge as RFEdge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Node as KGNode, Relation } from '@mkg/shared';
import { CustomNode } from './CustomNode';
import { autoLayout } from './layout';
import { RELATION_TYPE_LABELS } from './nodeColors';

const nodeTypes = { kg: CustomNode };

export interface CanvasProps {
  nodes: KGNode[];
  relations: Relation[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectRelation: (id: string | null) => void;
  onConnect: (source: string, target: string) => void;
  onDeleteNode: (id: string) => void;
  onCanvasDoubleClick: (pos: { x: number; y: number }) => void;
  /** Optional position map allows the editor to remember coordinates between renders. */
  positions?: Map<string, { x: number; y: number }>;
  onPositionChange?: (id: string, pos: { x: number; y: number }) => void;
}

export function GraphCanvas(props: CanvasProps) {
  const {
    nodes,
    relations,
    selectedNodeId,
    onSelectNode,
    onSelectRelation,
    onConnect,
    onDeleteNode,
    onCanvasDoubleClick,
    positions,
    onPositionChange,
  } = props;

  const rfNodes = useMemo(() => {
    const base: RFNode[] = nodes.map((n) => ({
      id: n.node_id,
      type: 'kg',
      data: { node: n },
      position: positions?.get(n.node_id) ?? { x: 0, y: 0 },
      selected: n.node_id === selectedNodeId,
    }));
    const needsLayout = base.some(
      (n) => !positions?.has(n.id) && n.position.x === 0 && n.position.y === 0,
    );
    if (!needsLayout) return base;
    const edges: RFEdge[] = relations
      .filter((r) => r.relation_id)
      .map((r) => ({ id: r.relation_id!, source: r.source_id, target: r.target_id }));
    return autoLayout(base, edges);
  }, [nodes, relations, positions, selectedNodeId]);

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      relations
        .filter((r) => r.relation_id)
        .map((r) => ({
          id: r.relation_id!,
          source: r.source_id,
          target: r.target_id,
          label: RELATION_TYPE_LABELS[r.relation_type],
          data: { relation: r },
          style:
            r.status === 'candidate'
              ? { strokeDasharray: '4 4', stroke: '#6B7280' }
              : { stroke: '#111827' },
        })),
    [relations],
  );

  const [, setNodesState] = useState<RFNode[]>(rfNodes);
  const [, setEdgesState] = useState<RFEdge[]>(rfEdges);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodesState((prev) => {
        const next = applyNodeChanges(changes, prev.length ? prev : rfNodes);
        for (const c of changes) {
          if (c.type === 'position' && c.position) {
            onPositionChange?.(c.id, c.position);
          }
        }
        return next;
      });
    },
    [rfNodes, onPositionChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdgesState((prev) => applyEdgeChanges(changes, prev.length ? prev : rfEdges));
    },
    [rfEdges],
  );

  const handleConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) {
        onConnect(c.source, c.target);
      }
    },
    [onConnect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        onDeleteNode(selectedNodeId);
      }
    },
    [selectedNodeId, onDeleteNode],
  );

  const handlePaneDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Only react when double-clicking the empty pane (not a node).
      if (target.closest('.react-flow__node')) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onCanvasDoubleClick({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [onCanvasDoubleClick],
  );

  return (
    <div
      data-testid="graph-canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDoubleClick={handlePaneDoubleClick}
      style={{ width: '100%', height: '100%', outline: 'none' }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, n) => onSelectNode(n.id)}
        onEdgeClick={(_, e) => onSelectRelation(e.id)}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectRelation(null);
        }}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
