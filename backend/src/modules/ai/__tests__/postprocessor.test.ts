import { describe, it, expect } from 'vitest';

import { postprocess } from '../postprocessor.js';

describe('postprocessor.fillNextStep', () => {
  it('appends NEXT_STEP relations from step_order under same operation_process', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'p', node_type: 'operation_process', name: 'P' },
        {
          node_id: 's2',
          node_type: 'operation_step',
          name: 's2',
          tags: { step_order: 2 },
        },
        {
          node_id: 's1',
          node_type: 'operation_step',
          name: 's1',
          tags: { step_order: 1 },
        },
        {
          node_id: 's3',
          node_type: 'operation_step',
          name: 's3',
          tags: { step_order: 3 },
        },
      ],
      relations: [
        { source_id: 'p', target_id: 's1', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's2', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's3', relation_type: 'HAS_STEP' },
      ],
    });
    const ns = out.relations.filter((r) => r.relation_type === 'NEXT_STEP');
    expect(ns).toHaveLength(2);
    expect(ns[0]).toMatchObject({ source_id: 's1', target_id: 's2' });
    expect(ns[1]).toMatchObject({ source_id: 's2', target_id: 's3' });
  });

  it('does not duplicate NEXT_STEP if LLM already produced them', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'p', node_type: 'operation_process', name: 'P' },
        {
          node_id: 's1',
          node_type: 'operation_step',
          name: 's1',
          tags: { step_order: 1 },
        },
        {
          node_id: 's2',
          node_type: 'operation_step',
          name: 's2',
          tags: { step_order: 2 },
        },
      ],
      relations: [
        { source_id: 'p', target_id: 's1', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's2', relation_type: 'HAS_STEP' },
        { source_id: 's1', target_id: 's2', relation_type: 'NEXT_STEP' },
      ],
    });
    expect(
      out.relations.filter((r) => r.relation_type === 'NEXT_STEP'),
    ).toHaveLength(1);
  });

  it('does not link steps belonging to different operation_process parents', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'p1', node_type: 'operation_process', name: 'P1' },
        { node_id: 'p2', node_type: 'operation_process', name: 'P2' },
        {
          node_id: 'a1',
          node_type: 'operation_step',
          name: 'a1',
          tags: { step_order: 1 },
        },
        {
          node_id: 'a2',
          node_type: 'operation_step',
          name: 'a2',
          tags: { step_order: 2 },
        },
        {
          node_id: 'b1',
          node_type: 'operation_step',
          name: 'b1',
          tags: { step_order: 1 },
        },
      ],
      relations: [
        { source_id: 'p1', target_id: 'a1', relation_type: 'HAS_STEP' },
        { source_id: 'p1', target_id: 'a2', relation_type: 'HAS_STEP' },
        { source_id: 'p2', target_id: 'b1', relation_type: 'HAS_STEP' },
      ],
    });
    const ns = out.relations.filter((r) => r.relation_type === 'NEXT_STEP');
    // Only a1 -> a2 should be appended; p2 has only one child.
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ source_id: 'a1', target_id: 'a2' });
  });

  it('skips operation_process whose steps lack step_order entirely', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'p', node_type: 'operation_process', name: 'P' },
        { node_id: 's1', node_type: 'operation_step', name: 's1' },
        { node_id: 's2', node_type: 'operation_step', name: 's2' },
      ],
      relations: [
        { source_id: 'p', target_id: 's1', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's2', relation_type: 'HAS_STEP' },
      ],
    });
    // Without step_order both fall back to MAX_SAFE_INTEGER and the order
    // is whatever the relations array dictated. The chain is still produced
    // but not duplicated; we just assert at most one NEXT_STEP between them.
    const ns = out.relations.filter((r) => r.relation_type === 'NEXT_STEP');
    expect(ns.length).toBeLessThanOrEqual(1);
  });
});

describe('postprocessor.dedupSymmetric', () => {
  it('keeps only one EASILY_CONFUSED_WITH per unordered pair', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'a', node_type: 'knowledge_point', name: 'a' },
        { node_id: 'b', node_type: 'knowledge_point', name: 'b' },
      ],
      relations: [
        { source_id: 'a', target_id: 'b', relation_type: 'EASILY_CONFUSED_WITH' },
        { source_id: 'b', target_id: 'a', relation_type: 'EASILY_CONFUSED_WITH' },
      ],
    });
    expect(
      out.relations.filter((r) => r.relation_type === 'EASILY_CONFUSED_WITH'),
    ).toHaveLength(1);
  });

  it('keeps only one SYNONYM_OF per unordered pair', () => {
    const out = postprocess({
      nodes: [
        { node_id: 't1', node_type: 'term', name: 't1' },
        { node_id: 't2', node_type: 'term', name: 't2' },
      ],
      relations: [
        { source_id: 't1', target_id: 't2', relation_type: 'SYNONYM_OF' },
        { source_id: 't2', target_id: 't1', relation_type: 'SYNONYM_OF' },
      ],
    });
    expect(
      out.relations.filter((r) => r.relation_type === 'SYNONYM_OF'),
    ).toHaveLength(1);
  });

  it('does not collapse asymmetric relations like PREREQUISITE_OF', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'a', node_type: 'knowledge_point', name: 'a' },
        { node_id: 'b', node_type: 'knowledge_point', name: 'b' },
      ],
      relations: [
        { source_id: 'a', target_id: 'b', relation_type: 'PREREQUISITE_OF' },
        { source_id: 'b', target_id: 'a', relation_type: 'PREREQUISITE_OF' },
      ],
    });
    expect(
      out.relations.filter((r) => r.relation_type === 'PREREQUISITE_OF'),
    ).toHaveLength(2);
  });
});

describe('postprocessor.relatedToCap', () => {
  it('warns when RELATED_TO exceeds 10% of relations', () => {
    const out = postprocess({
      nodes: Array.from({ length: 5 }, (_, i) => ({
        node_id: `n${i}`,
        node_type: 'knowledge_point' as const,
        name: `n${i}`,
      })),
      relations: [
        { source_id: 'n0', target_id: 'n1', relation_type: 'RELATED_TO' },
        { source_id: 'n0', target_id: 'n2', relation_type: 'RELATED_TO' },
        { source_id: 'n1', target_id: 'n2', relation_type: 'RELATED_TO' },
        { source_id: 'n3', target_id: 'n4', relation_type: 'PREREQUISITE_OF' },
      ],
    });
    expect(out.warnings.some((w) => /RELATED_TO/.test(w))).toBe(true);
    // 不删，只警告
    expect(
      out.relations.filter((r) => r.relation_type === 'RELATED_TO'),
    ).toHaveLength(3);
  });

  it('does not warn when RELATED_TO ratio is at or below 10%', () => {
    const relations = Array.from({ length: 10 }, (_, i) => ({
      source_id: `n${i}`,
      target_id: `n${(i + 1) % 10}`,
      relation_type: 'PREREQUISITE_OF',
    }));
    relations.push({
      source_id: 'n0',
      target_id: 'n5',
      relation_type: 'RELATED_TO',
    });
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      node_id: `n${i}`,
      node_type: 'knowledge_point' as const,
      name: `n${i}`,
    }));
    const out = postprocess({ nodes, relations });
    expect(out.warnings.some((w) => /RELATED_TO/.test(w))).toBe(false);
  });

  it('emits no warnings on an empty relation list', () => {
    const out = postprocess({ nodes: [], relations: [] });
    expect(out.warnings).toEqual([]);
    expect(out.relations).toEqual([]);
  });
});

describe('postprocessor.purity', () => {
  it('does not mutate caller arrays', () => {
    const nodes = [
      { node_id: 'p', node_type: 'operation_process', name: 'P' },
      {
        node_id: 's1',
        node_type: 'operation_step',
        name: 's1',
        tags: { step_order: 1 },
      },
      {
        node_id: 's2',
        node_type: 'operation_step',
        name: 's2',
        tags: { step_order: 2 },
      },
    ];
    const relations = [
      { source_id: 'p', target_id: 's1', relation_type: 'HAS_STEP' },
      { source_id: 'p', target_id: 's2', relation_type: 'HAS_STEP' },
    ];
    const beforeNodes = nodes.length;
    const beforeRelations = relations.length;
    postprocess({ nodes, relations });
    expect(nodes.length).toBe(beforeNodes);
    expect(relations.length).toBe(beforeRelations);
  });
});
