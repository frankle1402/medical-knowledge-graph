import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('seed.ts NURSING_CHAPTER_TEMPLATE v2', () => {
  const src = readFileSync(resolve(__dirname, '..', 'seed.ts'), 'utf-8');

  it('declares prompt_version medical_kg_v2', () => {
    expect(src).toMatch(/medical_kg_v2/);
  });

  it.each([
    'operation_process',
    'risk',
    'error',
    'measure',
    'assessment_item',
  ])('system_prompt mentions node type %s', (t) => {
    expect(src).toContain(t);
  });

  it.each([
    'HAS_STEP',
    'NEXT_STEP',
    'HAS_RISK',
    'HANDLED_BY',
    'PREVENTED_BY',
    'COMMON_ERROR_OF',
    'HAS_TERM',
    'ALIAS_OF',
    'HAS_CHAPTER',
    'HAS_SECTION',
    'HAS_KNOWLEDGE_POINT',
  ])('system_prompt mentions relation type %s', (t) => {
    expect(src).toContain(t);
  });

  it('forbids CONTAINS / BELONGS_TO in system prompt instructions', () => {
    // 提示词里必须出现"禁用 CONTAINS / BELONGS_TO"字样
    expect(src).toMatch(/禁止.*CONTAINS|不再.*CONTAINS|不要.*BELONGS_TO/);
  });

  it('caps RELATED_TO usage', () => {
    expect(src).toMatch(/RELATED_TO.*10%|RELATED_TO.*不得/);
  });
});
