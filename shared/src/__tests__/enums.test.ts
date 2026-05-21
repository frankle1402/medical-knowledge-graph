import { describe, it, expect } from 'vitest';
import {
  NodeType,
  KnowledgeType,
  Difficulty,
  Importance,
  RelationType,
  CompetencyLevel,
  NodeStatus,
  NodeSource,
  UserRole,
  GraphType,
} from '../enums';

describe('enums', () => {
  it('NodeType 包含设计文档定义的节点类型（v2 扩充后 16 种）', () => {
    expect(NodeType.options).toEqual([
      'textbook',
      'chapter',
      'section',
      'knowledge_point',
      'term',
      'operation_process',
      'operation_step',
      'competency',
      'risk',
      'error',
      'measure',
      'assessment_item',
      'image',
      'table',
      'question',
      'case',
    ]);
  });

  it('KnowledgeType 含 12 个枚举值', () => {
    expect(KnowledgeType.options.length).toBe(12);
    expect(KnowledgeType.options).toContain('异常处理类');
  });

  it('RelationType 含层级、知识、资源、术语、能力、归属六组', () => {
    expect(RelationType.options).toContain('CONTAINS');
    expect(RelationType.options).toContain('PREREQUISITE_OF');
    expect(RelationType.options).toContain('BELONGS_TO_GRAPH');
  });

  it('Difficulty 三档', () => {
    expect(Difficulty.options).toEqual(['基础', '中等', '较难']);
  });

  it('Importance 三档', () => {
    expect(Importance.options).toEqual(['高频考点', '重点掌握', '一般了解']);
  });

  it('CompetencyLevel 三档', () => {
    expect(CompetencyLevel.options).toEqual(['核心能力', '基础能力', '支持能力']);
  });

  it('NodeStatus 四态', () => {
    expect(NodeStatus.options).toEqual(['candidate', 'approved', 'rejected', 'archived']);
  });

  it('NodeSource 三类', () => {
    expect(NodeSource.options).toEqual(['manual', 'ai_generated', 'imported']);
  });

  it('UserRole 四角色', () => {
    expect(UserRole.options).toEqual(['admin', 'expert', 'operator', 'ai_service']);
  });

  it('GraphType 四类型', () => {
    expect(GraphType.options).toEqual(['course', 'chapter', 'subject', 'custom']);
  });
});

describe('v2 medical KG taxonomy', () => {
  it.each([
    'operation_process',
    'risk',
    'error',
    'measure',
    'assessment_item',
  ])('NodeType accepts %s', (t) => {
    expect(NodeType.parse(t)).toBe(t);
  });

  it.each([
    'HAS_CHAPTER',
    'HAS_SECTION',
    'HAS_KNOWLEDGE_POINT',
    'HAS_PROCESS',
    'HAS_STEP',
    'NEXT_STEP',
    'HAS_RISK',
    'HANDLED_BY',
    'PREVENTED_BY',
    'MANIFESTED_AS',
    'COMMON_ERROR_OF',
    'HAS_TERM',
    'ALIAS_OF',
    'ASSESSED_BY',
  ])('RelationType accepts %s', (t) => {
    expect(RelationType.parse(t)).toBe(t);
  });

  it('still rejects unknown types', () => {
    expect(() => NodeType.parse('chunk_v2')).toThrow();
    expect(() => RelationType.parse('FOO_BAR')).toThrow();
  });
});
