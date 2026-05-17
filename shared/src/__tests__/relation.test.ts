import { describe, it, expect } from 'vitest';
import { Relation, RelationCreateInput } from '../schemas/relation';
import { Graph, GraphCreateInput } from '../schemas/graph';
import {
  AIGenerateRequest,
  AIGenerateOutput,
  AIJob,
  ApproveBody,
  AIGenerationLog,
  LLMConfig,
  LLMGraphOutput,
} from '../schemas/ai';

describe('relation/graph/ai schemas', () => {
  it('Relation 校验通过', () => {
    expect(
      Relation.safeParse({
        source_id: 'KP_1',
        target_id: 'KP_2',
        relation_type: 'PREREQUISITE_OF',
        confidence: 0.9,
      }).success,
    ).toBe(true);
  });

  it('Relation confidence 越界失败', () => {
    expect(
      Relation.safeParse({
        source_id: 'a',
        target_id: 'b',
        relation_type: 'CONTAINS',
        confidence: 1.5,
      }).success,
    ).toBe(false);
  });

  it('Relation ai_job_id 接受 uuid', () => {
    expect(
      Relation.safeParse({
        source_id: 'a',
        target_id: 'b',
        relation_type: 'CONTAINS',
        ai_job_id: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true);
  });

  it('RelationCreateInput 不需要 status', () => {
    expect(
      RelationCreateInput.safeParse({
        source_id: 'a',
        target_id: 'b',
        relation_type: 'CONTAINS',
      }).success,
    ).toBe(true);
  });

  it('Graph graph_type 限定', () => {
    expect(
      Graph.safeParse({
        graph_id: 'g1',
        graph_name: '基础护理',
        graph_type: 'course',
      }).success,
    ).toBe(true);
  });

  it('GraphCreateInput 不要 graph_id', () => {
    expect(
      GraphCreateInput.safeParse({
        graph_name: '基础护理',
        graph_type: 'course',
      }).success,
    ).toBe(true);
  });

  it('AIGenerateRequest variables 支持 string|number|boolean', () => {
    expect(
      AIGenerateRequest.safeParse({
        template_id: '550e8400-e29b-41d4-a716-446655440000',
        variables: { topic: '静脉输液', depth: 3, advanced: true },
      }).success,
    ).toBe(true);
  });

  it('AIGenerateOutput 必含 nodes/relations', () => {
    expect(AIGenerateOutput.safeParse({ graph_name: 'x', nodes: [], relations: [] }).success).toBe(
      true,
    );
  });

  it('LLMGraphOutput 是 AIGenerateOutput 的别名', () => {
    expect(LLMGraphOutput.safeParse({ graph_name: 'x', nodes: [], relations: [] }).success).toBe(
      true,
    );
  });

  it('AIJob 接受 success 状态附带 output', () => {
    expect(
      AIJob.safeParse({
        job_id: 'job-1',
        status: 'success',
        output: { nodes: [], relations: [] },
      }).success,
    ).toBe(true);
  });

  it('ApproveBody 默认空数组', () => {
    const r = ApproveBody.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.node_ids).toEqual([]);
      expect(r.data.relation_ids).toEqual([]);
    }
  });

  it('AIGenerationLog 接受可空字段', () => {
    expect(
      AIGenerationLog.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'success',
        nodes_created: 5,
        relations_created: 3,
      }).success,
    ).toBe(true);
  });

  it('LLMConfig 必含 api_key_set', () => {
    expect(
      LLMConfig.safeParse({
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        api_key_set: true,
      }).success,
    ).toBe(true);
  });
});
