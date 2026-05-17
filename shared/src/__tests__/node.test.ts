import { describe, it, expect } from 'vitest';
import {
  BaseNode,
  KnowledgePointNode,
  TermNode,
  Node,
  NodeCreateInput,
  NodeUpdateInput,
} from '../schemas/node';

describe('node schemas', () => {
  it('BaseNode 必填字段', () => {
    const r = BaseNode.safeParse({
      node_id: 'KP_1',
      node_type: 'knowledge_point',
      name: '静脉输液',
    });
    expect(r.success).toBe(true);
  });

  it('BaseNode 接受 ai_job_id', () => {
    const r = BaseNode.safeParse({
      node_id: 'KP_1',
      node_type: 'knowledge_point',
      name: '静脉输液',
      ai_job_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.success).toBe(true);
  });

  it('KnowledgePointNode 必含 knowledge_type', () => {
    const r = KnowledgePointNode.safeParse({
      node_id: 'KP_1',
      node_type: 'knowledge_point',
      name: '静脉输液',
      knowledge_type: '概念类',
    });
    expect(r.success).toBe(true);
  });

  it('KnowledgePointNode 缺 knowledge_type 应失败', () => {
    const r = KnowledgePointNode.safeParse({
      node_id: 'KP_1',
      node_type: 'knowledge_point',
      name: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('TermNode 必含 standard_term', () => {
    const r = TermNode.safeParse({
      node_id: 'T_1',
      node_type: 'term',
      name: 'IV',
      standard_term: '静脉注射',
      aliases: ['IV'],
    });
    expect(r.success).toBe(true);
  });

  it('Node 判别联合根据 node_type 选择正确分支', () => {
    const r = Node.safeParse({
      node_id: 'OP_1',
      node_type: 'operation_step',
      name: '消毒',
      step_order: 1,
      phase: '术前',
    });
    expect(r.success).toBe(true);
  });

  it('Node 判别联合 — 错误 node_type 失败', () => {
    const r = Node.safeParse({
      node_id: 'X_1',
      node_type: 'not_a_type',
      name: '哦',
    });
    expect(r.success).toBe(false);
  });

  it('NodeCreateInput 不要求 node_id（由后端生成）', () => {
    const r = NodeCreateInput.safeParse({
      node_type: 'knowledge_point',
      name: '静脉输液',
      knowledge_type: '概念类',
    });
    expect(r.success).toBe(true);
  });

  it('NodeUpdateInput 全部可选', () => {
    const r = NodeUpdateInput.safeParse({ name: '改名' });
    expect(r.success).toBe(true);
  });
});
