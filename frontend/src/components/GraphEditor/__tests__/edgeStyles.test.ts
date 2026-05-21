import { describe, it, expect } from 'vitest';
import {
  getEdgeStyle,
  isEdgeHiddenByDefault,
  buildEdgeStylesheet,
} from '../edgeStyles';

describe('getEdgeStyle', () => {
  it('returns red-ish solid for HAS_RISK', () => {
    const s = getEdgeStyle('HAS_RISK');
    expect(s.stroke.toLowerCase()).toMatch(/^#(ef|dc|f8|fb|fc|fd|fe)/);
    expect(s.strokeDasharray).toBeUndefined();
  });
  it('returns green-ish for HANDLED_BY', () => {
    const s = getEdgeStyle('HANDLED_BY');
    expect(s.stroke.toLowerCase()).toMatch(/^#(10|22|34|4a|65|6e)/);
  });
  it('returns dashed for PREREQUISITE_OF', () => {
    expect(getEdgeStyle('PREREQUISITE_OF').strokeDasharray).toBeTruthy();
  });
  it('falls back gracefully for unknown relation type', () => {
    const s = getEdgeStyle('FOO_BAR_UNKNOWN');
    expect(s.stroke).toBeTruthy();
  });
});

describe('isEdgeHiddenByDefault', () => {
  it('hides RELATED_TO', () => {
    expect(isEdgeHiddenByDefault('RELATED_TO')).toBe(true);
  });
  it('hides BELONGS_TO_GRAPH', () => {
    expect(isEdgeHiddenByDefault('BELONGS_TO_GRAPH')).toBe(true);
  });
  it('does not hide HAS_STEP / NEXT_STEP / HAS_RISK / HANDLED_BY', () => {
    for (const t of ['HAS_STEP', 'NEXT_STEP', 'HAS_RISK', 'HANDLED_BY']) {
      expect(isEdgeHiddenByDefault(t)).toBe(false);
    }
  });
});

describe('buildEdgeStylesheet', () => {
  it('produces a cytoscape selector for HAS_RISK with line-color set', () => {
    const sheet = buildEdgeStylesheet();
    const hit = sheet.find((s) => s.selector === 'edge[relation_type = "HAS_RISK"]');
    expect(hit).toBeDefined();
    expect((hit!.style as Record<string, unknown>)['line-color']).toBeTruthy();
    expect((hit!.style as Record<string, unknown>)['target-arrow-color']).toBeTruthy();
    expect((hit!.style as Record<string, unknown>)['width']).toBeTruthy();
  });

  it('marks PREREQUISITE_OF as dashed with a line-dash-pattern', () => {
    const sheet = buildEdgeStylesheet();
    const hit = sheet.find((s) => s.selector === 'edge[relation_type = "PREREQUISITE_OF"]');
    expect(hit).toBeDefined();
    expect((hit!.style as Record<string, unknown>)['line-style']).toBe('dashed');
    expect(Array.isArray((hit!.style as Record<string, unknown>)['line-dash-pattern'])).toBe(true);
  });

  it('emits a hidden-by-default rule for RELATED_TO and BELONGS_TO_GRAPH', () => {
    const sheet = buildEdgeStylesheet();
    const hidden = sheet.filter((s) =>
      /\[!showHidden\]/.test(s.selector) &&
      (s.selector.includes('"RELATED_TO"') || s.selector.includes('"BELONGS_TO_GRAPH"')),
    );
    expect(hidden.length).toBe(2);
    for (const h of hidden) {
      expect((h.style as Record<string, unknown>)['display']).toBe('none');
    }
  });
});
