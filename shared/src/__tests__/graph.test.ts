import { describe, it, expect } from 'vitest';
import { GraphUpdateInput } from '../schemas/graph';

describe('GraphUpdateInput', () => {
  it('接受仅修改 graph_name 的部分更新', () => {
    expect(GraphUpdateInput.safeParse({ graph_name: 'new' }).success).toBe(true);
  });

  it('拒绝非法 status 值', () => {
    expect(GraphUpdateInput.safeParse({ status: 'INVALID' }).success).toBe(false);
  });
});
