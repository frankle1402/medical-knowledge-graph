import { describe, it, expect } from 'vitest';
import { asTagsObject } from '../tags';

describe('asTagsObject', () => {
  it('returns {} for legacy array shape', () => {
    expect(asTagsObject(['a', 'b'])).toEqual({});
  });
  it('returns {} for null/undefined', () => {
    expect(asTagsObject(null)).toEqual({});
    expect(asTagsObject(undefined)).toEqual({});
  });
  it('returns the object as-is when given an object', () => {
    const o = { step_order: 1, aliases: ['x'] };
    expect(asTagsObject(o)).toEqual(o);
  });
});
