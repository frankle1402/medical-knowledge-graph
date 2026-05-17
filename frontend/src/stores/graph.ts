import { create } from 'zustand';
import type { Graph, Node as KGNode, Relation } from '@mkg/shared';

interface GraphState {
  graph: Graph | null;
  nodes: KGNode[];
  relations: Relation[];
  selectedNodeId: string | null;
  selectedRelationId: string | null;
  setGraph: (graph: Graph | null) => void;
  setNodes: (nodes: KGNode[]) => void;
  setRelations: (relations: Relation[]) => void;
  upsertNode: (node: KGNode) => void;
  removeNode: (nodeId: string) => void;
  upsertRelation: (relation: Relation) => void;
  removeRelation: (relationId: string) => void;
  selectNode: (id: string | null) => void;
  selectRelation: (id: string | null) => void;
  reset: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  graph: null,
  nodes: [],
  relations: [],
  selectedNodeId: null,
  selectedRelationId: null,
  setGraph: (graph) => set({ graph }),
  setNodes: (nodes) => set({ nodes }),
  setRelations: (relations) => set({ relations }),
  upsertNode: (node) =>
    set((s) => {
      const idx = s.nodes.findIndex((n) => n.node_id === node.node_id);
      if (idx === -1) return { nodes: [...s.nodes, node] };
      const next = s.nodes.slice();
      next[idx] = node;
      return { nodes: next };
    }),
  removeNode: (nodeId) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.node_id !== nodeId),
      relations: s.relations.filter((r) => r.source_id !== nodeId && r.target_id !== nodeId),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    })),
  upsertRelation: (relation) =>
    set((s) => {
      if (!relation.relation_id) return { relations: [...s.relations, relation] };
      const idx = s.relations.findIndex((r) => r.relation_id === relation.relation_id);
      if (idx === -1) return { relations: [...s.relations, relation] };
      const next = s.relations.slice();
      next[idx] = relation;
      return { relations: next };
    }),
  removeRelation: (relationId) =>
    set((s) => ({
      relations: s.relations.filter((r) => r.relation_id !== relationId),
      selectedRelationId: s.selectedRelationId === relationId ? null : s.selectedRelationId,
    })),
  selectNode: (id) => set({ selectedNodeId: id, selectedRelationId: null }),
  selectRelation: (id) => set({ selectedRelationId: id, selectedNodeId: null }),
  reset: () =>
    set({
      graph: null,
      nodes: [],
      relations: [],
      selectedNodeId: null,
      selectedRelationId: null,
    }),
}));
