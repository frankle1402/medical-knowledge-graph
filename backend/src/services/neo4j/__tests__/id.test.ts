import { describe, it, expect } from 'vitest';
import {
  generateNodeId,
  generateGraphId,
  generateRelationId,
  isValidNodeId,
  isValidGraphId,
  isValidRelationId,
} from '../id';

describe('id generator (re-exported from @mkg/shared)', () => {
  it('generateNodeId returns prefixed unique ids per type', () => {
    const a = generateNodeId('knowledge_point');
    const b = generateNodeId('knowledge_point');
    expect(a).toMatch(/^KP_[A-Z0-9]{6,}$/);
    expect(a).not.toBe(b);
    expect(generateNodeId('term')).toMatch(/^TM_/);
    expect(generateNodeId('chapter')).toMatch(/^CH_/);
  });

  it('generateGraphId returns graph_ prefix', () => {
    expect(generateGraphId()).toMatch(/^graph_[a-z0-9]{6,}$/);
  });

  it('generateRelationId returns rel_ prefix', () => {
    expect(generateRelationId()).toMatch(/^rel_[a-z0-9]{6,}$/);
  });

  it('isValidNodeId only accepts node-style ids', () => {
    expect(isValidNodeId('KP_ABC123')).toBe(true);
    expect(isValidNodeId('graph_abc123')).toBe(false);
    expect(isValidNodeId('rel_abc123')).toBe(false);
    expect(isValidNodeId('not-an-id')).toBe(false);
  });

  it('isValidGraphId only accepts graph ids', () => {
    expect(isValidGraphId('graph_abc123')).toBe(true);
    expect(isValidGraphId('KP_ABC123')).toBe(false);
  });

  it('isValidRelationId only accepts relation ids', () => {
    expect(isValidRelationId('rel_abc123')).toBe(true);
    expect(isValidRelationId('graph_abc123')).toBe(false);
  });
});
