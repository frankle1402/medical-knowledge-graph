import dagre from 'dagre';
import type { Node as RFNode, Edge as RFEdge } from 'reactflow';

const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;

/**
 * Compute deterministic coordinates with dagre.
 * Used when nodes have no `position` (e.g. AI-generated batches).
 */
export function autoLayout(nodes: RFNode[], edges: RFEdge[]): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: pos ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } : { x: 0, y: 0 },
    };
  });
}
