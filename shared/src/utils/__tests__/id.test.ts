import { describe, it, expect } from 'vitest';
import {
  generateNodeId,
  generateGraphId,
  generateRelationId,
  isValidNodeId,
  isValidGraphId,
  isValidRelationId,
} from '../id';

describe('id utils', () => {
  it('generateNodeId 按节点类型选择前缀', () => {
    expect(generateNodeId('knowledge_point').startsWith('KP_')).toBe(true);
    expect(generateNodeId('term').startsWith('TM_')).toBe(true);
    expect(generateNodeId('operation_step').startsWith('OP_')).toBe(true);
    expect(generateNodeId('chapter').startsWith('CH_')).toBe(true);
  });

  it('generateNodeId 同一类型多次调用产生不同 ID', () => {
    const a = generateNodeId('knowledge_point');
    const b = generateNodeId('knowledge_point');
    expect(a).not.toBe(b);
  });

  it('generateGraphId 以 graph_ 开头', () => {
    expect(generateGraphId().startsWith('graph_')).toBe(true);
  });

  it('generateRelationId 以 rel_ 开头', () => {
    expect(generateRelationId().startsWith('rel_')).toBe(true);
  });

  it('isValidNodeId 接受合法格式', () => {
    expect(isValidNodeId('KP_001')).toBe(true);
    expect(isValidNodeId('KP_ABCDEF1234')).toBe(true);
    expect(isValidNodeId(generateNodeId('knowledge_point'))).toBe(true);
  });

  it('isValidNodeId 拒绝错误格式', () => {
    expect(isValidNodeId('invalid id')).toBe(false);
    expect(isValidNodeId('kp_001')).toBe(false); // 小写前缀
    expect(isValidNodeId('graph_xyz')).toBe(false); // graph 前缀不属于 node
  });

  it('isValidGraphId 拒绝 node id', () => {
    expect(isValidGraphId('graph_abcdef')).toBe(true);
    expect(isValidGraphId(generateGraphId())).toBe(true);
    expect(isValidGraphId('KP_001')).toBe(false);
  });

  it('isValidRelationId 拒绝 node id', () => {
    expect(isValidRelationId('rel_abcdef')).toBe(true);
    expect(isValidRelationId(generateRelationId())).toBe(true);
    expect(isValidRelationId('KP_001')).toBe(false);
  });
});
