import { describe, expect, it, beforeEach } from 'vitest';
import { useGraphStore } from '../graph';
import { useAuthStore } from '../auth';
import type { Node as KGNode, Relation, User } from '@mkg/shared';

const baseNode: KGNode = {
  node_id: 'KP_A',
  node_type: 'knowledge_point',
  name: 'A',
  status: 'approved',
  confidence: 1,
  source: 'manual',
  knowledge_type: '概念类',
  tags: {},
} as unknown as KGNode;

const otherNode: KGNode = { ...baseNode, node_id: 'KP_B', name: 'B' } as unknown as KGNode;

const rel: Relation = {
  relation_id: 'rel_1',
  source_id: 'KP_A',
  target_id: 'KP_B',
  relation_type: 'RELATED_TO',
  status: 'approved',
  source: 'manual',
  confidence: 1,
};

describe('useGraphStore', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
  });

  it('upserts and removes nodes, cascading relation cleanup', () => {
    const s = useGraphStore.getState();
    s.upsertNode(baseNode);
    s.upsertNode(otherNode);
    s.upsertRelation(rel);
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.getState().relations).toHaveLength(1);
    s.removeNode('KP_A');
    const after = useGraphStore.getState();
    expect(after.nodes.map((n) => n.node_id)).toEqual(['KP_B']);
    expect(after.relations).toHaveLength(0);
  });

  it('selectNode clears any selected relation and vice versa', () => {
    const s = useGraphStore.getState();
    s.selectNode('KP_A');
    expect(useGraphStore.getState().selectedNodeId).toBe('KP_A');
    expect(useGraphStore.getState().selectedRelationId).toBeNull();
    s.selectRelation('rel_1');
    expect(useGraphStore.getState().selectedRelationId).toBe('rel_1');
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('upsertNode replaces existing node by id', () => {
    const s = useGraphStore.getState();
    s.upsertNode(baseNode);
    s.upsertNode({ ...baseNode, name: 'A2' } as KGNode);
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().nodes[0]?.name).toBe('A2');
  });
});

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null, initialized: false });
  });

  it('persists token via localStorage on setAuth', () => {
    const u: User = {
      id: '00000000-0000-0000-0000-000000000001',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
    };
    useAuthStore.getState().setAuth('TOKEN', u);
    expect(localStorage.getItem('mkg.token')).toBe('TOKEN');
    expect(useAuthStore.getState().user?.username).toBe('admin');
  });

  it('logout clears stored token', () => {
    localStorage.setItem('mkg.token', 'X');
    useAuthStore.setState({ token: 'X' });
    useAuthStore.getState().logout();
    expect(localStorage.getItem('mkg.token')).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });
});
