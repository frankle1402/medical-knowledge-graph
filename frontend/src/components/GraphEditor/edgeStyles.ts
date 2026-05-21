import type { RelationType } from '@mkg/shared';

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

const STYLES: Partial<Record<RelationType, EdgeStyle>> = {
  // 教材结构 — 灰
  HAS_CHAPTER:         { stroke: '#9CA3AF', strokeWidth: 1.5 },
  HAS_SECTION:         { stroke: '#9CA3AF', strokeWidth: 1.5 },
  HAS_KNOWLEDGE_POINT: { stroke: '#6B7280', strokeWidth: 1.5 },
  CONTAINS:            { stroke: '#9CA3AF', strokeWidth: 1.5 },
  BELONGS_TO:          { stroke: '#9CA3AF', strokeWidth: 1.5 },

  // 操作流程 — 蓝/橙实线
  HAS_PROCESS:         { stroke: '#1E40AF', strokeWidth: 2 },
  HAS_STEP:            { stroke: '#2563EB', strokeWidth: 2 },
  NEXT_STEP:           { stroke: '#3B82F6', strokeWidth: 2.5 },

  // 前置 — 紫色虚线
  PREREQUISITE_OF:     { stroke: '#7C3AED', strokeWidth: 2, strokeDasharray: '6 4' },

  // 风险/错误 — 红/橙
  HAS_RISK:            { stroke: '#EF4444', strokeWidth: 2 },
  COMMON_ERROR_OF:     { stroke: '#F97316', strokeWidth: 1.5, strokeDasharray: '2 2' },
  MANIFESTED_AS:       { stroke: '#FB923C', strokeWidth: 1.5 },

  // 处理/预防 — 绿
  HANDLED_BY:          { stroke: '#10B981', strokeWidth: 2 },
  PREVENTED_BY:        { stroke: '#059669', strokeWidth: 2, strokeDasharray: '4 4' },

  // 易混 — 双向暗示，黄色
  EASILY_CONFUSED_WITH:{ stroke: '#F59E0B', strokeWidth: 1.5, strokeDasharray: '3 3' },

  // 教学应用 — 紫
  SUPPORTS_COMPETENCY: { stroke: '#A855F7', strokeWidth: 1.5 },
  ASSESSED_BY:         { stroke: '#C084FC', strokeWidth: 1.5 },
  TESTED_BY:           { stroke: '#C084FC', strokeWidth: 1.5, strokeDasharray: '4 2' },
  APPLIED_IN:          { stroke: '#C084FC', strokeWidth: 1.5 },

  // 术语 — 青
  HAS_TERM:            { stroke: '#06B6D4', strokeWidth: 1.5 },
  ALIAS_OF:            { stroke: '#22D3EE', strokeWidth: 1, strokeDasharray: '2 2' },
  STANDARD_TERM_OF:    { stroke: '#06B6D4', strokeWidth: 1.5 },
  SYNONYM_OF:          { stroke: '#22D3EE', strokeWidth: 1, strokeDasharray: '2 2' },

  // 资源 — 灰
  ILLUSTRATED_BY:      { stroke: '#94A3B8', strokeWidth: 1 },
  DESCRIBED_IN:        { stroke: '#94A3B8', strokeWidth: 1 },

  // 弱关联/图谱归属 — 默认隐藏
  RELATED_TO:          { stroke: '#D1D5DB', strokeWidth: 1, strokeDasharray: '1 3' },
  BELONGS_TO_GRAPH:    { stroke: '#E5E7EB', strokeWidth: 0.5 },
  MERGED_INTO:         { stroke: '#E5E7EB', strokeWidth: 0.5 },
  RELATED_GRAPH:       { stroke: '#E5E7EB', strokeWidth: 0.5 },
};

const FALLBACK: EdgeStyle = { stroke: '#6B7280', strokeWidth: 1.5 };
const HIDDEN_BY_DEFAULT = new Set<string>(['RELATED_TO', 'BELONGS_TO_GRAPH']);

export function getEdgeStyle(t: RelationType | string): EdgeStyle {
  return (STYLES as Record<string, EdgeStyle>)[t] ?? FALLBACK;
}

export function isEdgeHiddenByDefault(t: RelationType | string): boolean {
  return HIDDEN_BY_DEFAULT.has(t);
}

/**
 * 把上面的 STYLES 表渲染为 cytoscape stylesheet selector 数组，
 * 供 GraphCanvas 在 cytoscape({ style: [...baseStyle, ...buildEdgeStylesheet()] }) 里使用。
 *
 * 每条 selector 形如 `edge[relation_type = "HAS_RISK"]`，命中由 GraphCanvas 在
 * elements 构造时往 edge.data.relation_type 写入的字段。
 */
export function buildEdgeStylesheet(): Array<{ selector: string; style: Record<string, unknown> }> {
  const out: Array<{ selector: string; style: Record<string, unknown> }> = [];
  for (const [relType, s] of Object.entries(STYLES)) {
    if (!s) continue;
    const style: Record<string, unknown> = {
      'line-color': s.stroke,
      'target-arrow-color': s.stroke,
      width: s.strokeWidth,
    };
    if (s.strokeDasharray) {
      style['line-style'] = 'dashed';
      // cytoscape 支持 line-dash-pattern: [on, off]
      const parts = s.strokeDasharray.split(/\s+/).map(Number).filter((x) => !Number.isNaN(x));
      if (parts.length >= 2) style['line-dash-pattern'] = parts.slice(0, 2);
    }
    out.push({ selector: `edge[relation_type = "${relType}"]`, style });
  }
  // 默认隐藏的关系类型再追加 visibility:hidden（用户在筛选面板勾选才显示）
  for (const t of HIDDEN_BY_DEFAULT) {
    out.push({
      selector: `edge[relation_type = "${t}"][!showHidden]`,
      style: { display: 'none' },
    });
  }
  return out;
}
