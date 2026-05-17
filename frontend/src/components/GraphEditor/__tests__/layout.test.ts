import { describe, expect, it } from 'vitest';
import { autoLayout } from '../layout';

describe('autoLayout', () => {
  it('produces non-zero coordinates for connected nodes', () => {
    const nodes = [
      { id: 'A', position: { x: 0, y: 0 }, data: {} },
      { id: 'B', position: { x: 0, y: 0 }, data: {} },
      { id: 'C', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'C' },
    ];
    const out = autoLayout(
      nodes as Parameters<typeof autoLayout>[0],
      edges as Parameters<typeof autoLayout>[1],
    );
    expect(out).toHaveLength(3);
    // Different ids should land at different x coordinates with rankdir LR.
    const xs = out.map((n) => n.position.x);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
});
