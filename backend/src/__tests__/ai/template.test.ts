import { describe, it, expect } from 'vitest';
import type { TemplateVariable } from '@mkg/shared';

import {
  TemplateRenderError,
  renderPrompt,
  renderTemplate,
} from '../../modules/ai/template.js';

describe('renderTemplate (Handlebars)', () => {
  it('renders simple variable substitution', () => {
    const out = renderTemplate('Hello {{name}}', { name: 'world' });
    expect(out).toBe('Hello world');
  });

  it('does NOT HTML-escape by default (prompts are plain text)', () => {
    const out = renderTemplate('Q: {{q}}', { q: '<x> & "y"' });
    expect(out).toBe('Q: <x> & "y"');
  });

  it('strict mode throws on undefined variable', () => {
    expect(() => renderTemplate('{{a}} {{missing}}', { a: '1' })).toThrow(
      TemplateRenderError,
    );
  });

  it('throws TemplateRenderError on bad template syntax', () => {
    expect(() => renderTemplate('{{#if}}', {})).toThrow(TemplateRenderError);
  });
});

describe('renderPrompt (validate + render in one step)', () => {
  const variableDefs: TemplateVariable[] = [
    { key: 'course_name', label: '课程', type: 'text', required: true },
    { key: 'chapter_name', label: '章节', type: 'text', required: true },
    {
      key: 'depth',
      label: '详细程度',
      type: 'select',
      options: ['基础', '标准', '详细'],
      default: '标准',
      required: false,
    },
  ];
  const template = '请为《{{course_name}}》中的「{{chapter_name}}」构建图谱。详细程度：{{depth}}';

  it('renders with all valid variables', () => {
    const { prompt } = renderPrompt({
      template,
      variableDefs,
      input: { course_name: '基础护理学', chapter_name: '静脉输液与输血', depth: '标准' },
    });
    expect(prompt).toBe(
      '请为《基础护理学》中的「静脉输液与输血」构建图谱。详细程度：标准',
    );
  });

  it('uses default for missing optional', () => {
    const { prompt, values } = renderPrompt({
      template,
      variableDefs,
      input: { course_name: '基础护理学', chapter_name: '静脉输液与输血' },
    });
    expect(values.depth).toBe('标准');
    expect(prompt).toContain('标准');
  });

  it('throws when required variable is missing', () => {
    expect(() =>
      renderPrompt({
        template,
        variableDefs,
        input: { chapter_name: 'x' },
      }),
    ).toThrow(/course_name/);
  });

  it('throws when select value is invalid (type validation)', () => {
    expect(() =>
      renderPrompt({
        template,
        variableDefs,
        input: { course_name: 'a', chapter_name: 'b', depth: '魔鬼' },
      }),
    ).toThrow(/depth/);
  });
});
