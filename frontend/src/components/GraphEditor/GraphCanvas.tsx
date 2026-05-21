import { useCallback, useEffect, useMemo, useRef } from 'react';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
  type EventObjectNode,
  type EventObjectEdge,
} from 'cytoscape';
import edgehandles from 'cytoscape-edgehandles';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { Node as KGNode, Relation } from '@mkg/shared';
import { NODE_COLORS, NODE_TYPE_LABELS, RELATION_TYPE_LABELS } from './nodeColors';

if (!(cytoscape as unknown as { _mkgRegistered?: boolean })._mkgRegistered) {
  cytoscape.use(coseBilkent);
  cytoscape.use(edgehandles);
  (cytoscape as unknown as { _mkgRegistered: boolean })._mkgRegistered = true;
}

// Step factor for the toolbar +/− zoom buttons. Module-scope so it stays
// stable across re-renders and is testable as a black-box constant.
const ZOOM_STEP = 1.2;

export interface CanvasProps {
  nodes: KGNode[];
  relations: Relation[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectRelation: (id: string | null) => void;
  onConnect: (source: string, target: string) => void;
  onDeleteNode: (id: string) => void;
  onCanvasDoubleClick: (pos: { x: number; y: number }) => void;
  positions?: Map<string, { x: number; y: number }>;
  onPositionChange?: (id: string, pos: { x: number; y: number }) => void;
  /** Set of node ids whose 1-hop neighborhood is highlighted; others get dimmed.
   *  Empty set = focus mode off. */
  focusedNodeIds?: ReadonlySet<string>;
  /** Called when user double-clicks a dimmed (non-focused) node — parent should
   *  add it to the focus set to grow the visible subgraph. */
  onExpandFocus?: (nodeId: string) => void;
  /** Called when user double-clicks an edge — parent opens the edit dialog. */
  onEditRelation?: (relationId: string) => void;
}

interface EdgeHandlesInstance {
  destroy(): void;
  start(node: cytoscape.NodeSingular): void;
  stop(): void;
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
    focusedNodeIds,
    onExpandFocus,
    onEditRelation,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const edgeHandlesRef = useRef<EdgeHandlesInstance | null>(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // Keep latest callbacks in refs so we can attach cy listeners only once.
  const callbackRefs = useRef({
    onSelectNode,
    onSelectRelation,
    onConnect,
    onDeleteNode,
    onCanvasDoubleClick,
    onPositionChange,
    onExpandFocus,
    onEditRelation,
  });
  callbackRefs.current = {
    onSelectNode,
    onSelectRelation,
    onConnect,
    onDeleteNode,
    onCanvasDoubleClick,
    onPositionChange,
    onExpandFocus,
    onEditRelation,
  };

  // Latest focused-set ref so dblclick handler can read it without re-binding.
  const focusedRef = useRef<ReadonlySet<string> | undefined>(focusedNodeIds);
  focusedRef.current = focusedNodeIds;

  const elements = useMemo<ElementDefinition[]>(() => {
    const els: ElementDefinition[] = [];
    for (const n of nodes) {
      const saved = positions?.get(n.node_id);
      const def: ElementDefinition = {
        group: 'nodes',
        data: {
          id: n.node_id,
          label: n.name,
          type: n.node_type,
          typeLabel: NODE_TYPE_LABELS[n.node_type],
          status: n.status,
          color: NODE_COLORS[n.node_type],
        },
      };
      if (saved) def.position = { ...saved };
      els.push(def);
    }
    for (const r of relations) {
      if (!r.relation_id) continue;
      els.push({
        group: 'edges',
        data: {
          id: r.relation_id,
          source: r.source_id,
          target: r.target_id,
          label: RELATION_TYPE_LABELS[r.relation_type],
          status: r.status,
        },
      });
    }
    return els;
  }, [nodes, relations, positions]);

  // Compute the closed 1-hop neighborhood of focusedNodeIds in plain JS so the
  // hidden DOM mirror can label each node 'focused' | 'dimmed' without poking
  // at the cytoscape instance (which is async to React's render cycle).
  const focusInfo = useMemo(() => {
    if (!focusedNodeIds || focusedNodeIds.size === 0) {
      return { ring: new Set<string>() };
    }
    const ring = new Set<string>(focusedNodeIds);
    for (const r of relations) {
      if (focusedNodeIds.has(r.source_id)) ring.add(r.target_id);
      if (focusedNodeIds.has(r.target_id)) ring.add(r.source_id);
    }
    return { ring };
  }, [focusedNodeIds, relations]);

  // Init cytoscape exactly once when the container is mounted.
  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'font-size': 12,
            'font-weight': 600,
            width: 'label',
            height: 36,
            padding: '10px',
            shape: 'round-rectangle',
            'border-width': 2,
            'border-color': '#111827',
            'border-style': 'solid',
          },
        },
        {
          selector: 'node[status = "candidate"]',
          style: {
            'border-style': 'dashed',
            'border-color': '#9CA3AF',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#2563EB',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#111827',
            'target-arrow-color': '#111827',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            color: '#374151',
            'text-background-color': '#fff',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: 'edge[status = "candidate"]',
          style: {
            'line-style': 'dashed',
            'line-color': '#6B7280',
            'target-arrow-color': '#6B7280',
          },
        },
        {
          selector: 'edge:selected',
          style: {
            width: 3,
            'line-color': '#2563EB',
            'target-arrow-color': '#2563EB',
          },
        },
        // edgehandles helpers
        {
          selector: '.eh-handle',
          style: {
            'background-color': '#2563EB',
            width: 12,
            height: 12,
            shape: 'ellipse',
            'overlay-opacity': 0,
            'border-width': 2,
            'border-color': '#fff',
          },
        },
        {
          selector: '.eh-source',
          style: { 'border-width': 3, 'border-color': '#2563EB' },
        },
        {
          selector: '.eh-target',
          style: { 'border-width': 3, 'border-color': '#10B981' },
        },
        {
          selector: '.eh-preview, .eh-ghost-edge',
          style: {
            'background-color': '#2563EB',
            'line-color': '#2563EB',
            'target-arrow-color': '#2563EB',
            'line-style': 'dashed',
          },
        },
        {
          selector: '.eh-ghost-edge.eh-preview-active',
          style: { opacity: 0 },
        },
        // Focus-mode classes: applied imperatively when focusedNodeIds is set.
        {
          selector: '.dimmed',
          style: {
            opacity: 0.1,
            'text-opacity': 0,
            events: 'yes',
          },
        },
        {
          selector: '.focused',
          style: { opacity: 1 },
        },
      ],
      layout: { name: 'preset' },
    });
    cyRef.current = cy;

    // ---- Initial layout: only run cose-bilkent for nodes without saved positions.
    const needsLayout = cy.nodes().filter((n) => {
      const p = n.position();
      return p.x === 0 && p.y === 0;
    });
    if (needsLayout.length > 0) {
      cy.layout({
        name: 'cose-bilkent',
        animate: false,
        nodeRepulsion: 8000,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        gravity: 0.25,
        numIter: 2500,
        randomize: needsLayout.length === cy.nodes().length,
        fit: true,
        padding: 30,
        quality: 'default',
      } as unknown as cytoscape.LayoutOptions).run();

      cy.nodes().forEach((n) => {
        callbackRefs.current.onPositionChange?.(n.id(), { ...n.position() });
      });
    } else {
      cy.fit(undefined, 30);
    }

    // ---- edgehandles plugin: drag from a node to create a relation.
    const eh = (cy as unknown as { edgehandles: (opts: unknown) => EdgeHandlesInstance })
      .edgehandles({
        canConnect: (source: cytoscape.NodeSingular, target: cytoscape.NodeSingular) =>
          source.id() !== target.id(),
        snap: true,
        snapThreshold: 50,
        // Skip auto-creating an edge — we delegate to onConnect (REST round-trip).
        edgeParams: () => ({}),
        hoverDelay: 100,
      });
    edgeHandlesRef.current = eh;

    cy.on('ehcomplete', (_evt, sourceNode, targetNode, addedEdge) => {
      // Remove the auto-added preview edge; the parent will re-create via API.
      try {
        addedEdge.remove();
      } catch {
        // ignore
      }
      const s = (sourceNode as cytoscape.NodeSingular).id();
      const t = (targetNode as cytoscape.NodeSingular).id();
      if (s && t && s !== t) callbackRefs.current.onConnect(s, t);
    });

    // ---- Selection events
    cy.on('tap', 'node', (evt: EventObjectNode) => {
      callbackRefs.current.onSelectNode(evt.target.id());
    });
    cy.on('tap', 'edge', (evt: EventObjectEdge) => {
      callbackRefs.current.onSelectRelation(evt.target.id());
    });
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        callbackRefs.current.onSelectNode(null);
        callbackRefs.current.onSelectRelation(null);
      }
    });

    // ---- Position persistence after drag.
    cy.on('dragfree', 'node', (evt: EventObjectNode) => {
      const n = evt.target;
      callbackRefs.current.onPositionChange?.(n.id(), { ...n.position() });
    });

    // ---- Double-click:
    //   - on empty pane → create node
    //   - on an edge → open relation edit dialog
    //   - on a node while focus mode is active and that node is outside the
    //     focus set → expand focus to include it (Neo4j-style growing)
    cy.on('dblclick', (evt: EventObject) => {
      if (evt.target === cy) {
        const rendered = evt.renderedPosition ?? { x: 0, y: 0 };
        callbackRefs.current.onCanvasDoubleClick({ x: rendered.x, y: rendered.y });
        return;
      }
      const target = evt.target as cytoscape.Singular;
      if (target.isEdge && target.isEdge()) {
        callbackRefs.current.onEditRelation?.(target.id());
        return;
      }
      if (target.isNode && target.isNode()) {
        const focused = focusedRef.current;
        if (focused && focused.size > 0 && !focused.has(target.id())) {
          callbackRefs.current.onExpandFocus?.(target.id());
        }
      }
    });

    return () => {
      try {
        edgeHandlesRef.current?.destroy();
      } catch {
        // ignore
      }
      edgeHandlesRef.current = null;
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Sync elements when nodes/relations change.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      const seen = new Set<string>();
      for (const el of elements) {
        const id = el.data?.id;
        if (!id) continue;
        seen.add(id);
        const existing = cy.getElementById(id);
        if (existing.empty()) {
          cy.add(el);
        } else {
          existing.data(el.data ?? {});
          if (el.group === 'nodes' && el.position && existing.position().x === 0 && existing.position().y === 0) {
            existing.position(el.position);
          }
        }
      }
      cy.elements().forEach((el) => {
        if (!seen.has(el.id())) el.remove();
      });
    });

    const needsLayout = cy.nodes().filter((n) => {
      const p = n.position();
      return p.x === 0 && p.y === 0;
    });
    if (needsLayout.length > 0) {
      cy.layout({
        name: 'cose-bilkent',
        animate: false,
        nodeRepulsion: 8000,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        gravity: 0.25,
        numIter: 2500,
        randomize: false,
        fit: false,
        padding: 30,
        quality: 'default',
      } as unknown as cytoscape.LayoutOptions).run();

      cy.nodes().forEach((n) => {
        const cur = positionsRef.current?.get(n.id());
        if (!cur) callbackRefs.current.onPositionChange?.(n.id(), { ...n.position() });
      });
    }
  }, [elements]);

  // ---- Keep cy selection in sync with prop.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selectedNodeId) {
      cy.getElementById(selectedNodeId).select();
    }
  }, [selectedNodeId]);

  // ---- Focus mode: dim everything outside the closed neighborhood of the
  //      focused set. Empty set / undefined => clear classes (full graph).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('dimmed focused');
      if (!focusedNodeIds || focusedNodeIds.size === 0) return;
      const seeds = cy.nodes().filter((n) => focusedNodeIds.has(n.id()));
      if (seeds.length === 0) return;
      const ring = seeds.closedNeighborhood();
      ring.addClass('focused');
      cy.elements().not(ring).addClass('dimmed');
    });
  }, [focusedNodeIds, elements]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        callbackRefs.current.onDeleteNode(selectedNodeId);
      }
    },
    [selectedNodeId],
  );

  // expose a "run layout" button via floating control.
  const runLayout = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout({
      name: 'cose-bilkent',
      animate: 'end',
      animationDuration: 600,
      nodeRepulsion: 8000,
      idealEdgeLength: 120,
      edgeElasticity: 0.45,
      gravity: 0.25,
      numIter: 2500,
      randomize: true,
      fit: true,
      padding: 30,
      quality: 'default',
    } as unknown as cytoscape.LayoutOptions).run();
    cy.one('layoutstop', () => {
      cy.nodes().forEach((n) => {
        callbackRefs.current.onPositionChange?.(n.id(), { ...n.position() });
      });
    });
  };

  const fitView = () => {
    cyRef.current?.fit(undefined, 30);
  };

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const container = cy.container();
    const w = container?.clientWidth ?? 0;
    const h = container?.clientHeight ?? 0;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: w / 2, y: h / 2 } });
  };

  return (
    <div
      data-testid="graph-canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ width: '100%', height: '100%', outline: 'none', position: 'relative' }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={floatingControlsStyle}>
        <button type="button" onClick={runLayout} style={ctrlBtnStyle} title="重新布局" data-testid="canvas-auto-layout">
          自动布局
        </button>
        <button type="button" onClick={fitView} style={ctrlBtnStyle} title="适应视图" data-testid="canvas-fit-view">
          适应视图
        </button>
        <button type="button" onClick={() => zoomBy(ZOOM_STEP)} style={ctrlBtnGlyphStyle} title="放大" data-testid="canvas-zoom-in" aria-label="放大">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} style={ctrlBtnGlyphStyle} title="缩小" data-testid="canvas-zoom-out" aria-label="缩小">
          −
        </button>
      </div>
      {/* Hidden DOM mirror so e2e / unit tests can assert visibility by node label.
          data-focus = "focused" | "dimmed" | "none" reflects focus-mode state. */}
      <ul data-testid="canvas-nodes" style={hiddenListStyle} aria-hidden="true">
        {nodes.map((n) => {
          const focusState =
            !focusedNodeIds || focusedNodeIds.size === 0
              ? 'none'
              : focusInfo.ring.has(n.node_id)
                ? 'focused'
                : 'dimmed';
          return (
            <li
              key={n.node_id}
              data-testid={`canvas-node-${n.node_id}`}
              data-focus={focusState}
            >
              {n.name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const floatingControlsStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  display: 'flex',
  gap: 6,
  zIndex: 10,
};

const ctrlBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
};

const ctrlBtnGlyphStyle: React.CSSProperties = {
  ...ctrlBtnStyle,
  padding: '6px 10px',
  fontSize: 14,
  fontWeight: 600,
  minWidth: 30,
};

const hiddenListStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};
