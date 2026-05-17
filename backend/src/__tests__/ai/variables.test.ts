import { describe, it, expect } from 'vitest';
import type { TemplateVariable } from '@mkg/shared';

import {
  TemplateVariableError,
  validateVariables,
} from '../../modules/ai/variables.js';

describe('validateVariables (TemplateVariable five-type contract)', () => {
  it('text required + missing throws', () => {
    const defs: TemplateVariable[] = [
      { key: 'course_name', label: '课程', type: 'text', required: true },
    ];
    expect(() => validateVariables(defs, {})).toThrow(/course_name/);
  });

  it('text required + empty string throws', () => {
    const defs: TemplateVariable[] = [
      { key: 'course_name', label: '课程', type: 'text', required: true },
    ];
    expect(() => validateVariables(defs, { course_name: '' })).toThrow(
      /course_name/,
    );
  });

  it('textarea passes through as string', () => {
    const defs: TemplateVariable[] = [
      { key: 'notes', label: 'notes', type: 'textarea', required: false },
    ];
    expect(validateVariables(defs, { notes: 'long text' })).toEqual({
      notes: 'long text',
    });
  });

  it('select rejects values outside options', () => {
    const defs: TemplateVariable[] = [
      {
        key: 'depth',
        label: 'depth',
        type: 'select',
        options: ['基础', '标准', '详细'],
        required: true,
      },
    ];
    expect(() => validateVariables(defs, { depth: '魔鬼' })).toThrow(/depth/);
    expect(validateVariables(defs, { depth: '标准' })).toEqual({ depth: '标准' });
  });

  it('select with no options throws', () => {
    const defs: TemplateVariable[] = [
      { key: 'depth', label: 'depth', type: 'select', required: true },
    ];
    expect(() => validateVariables(defs, { depth: 'x' })).toThrow(/no options/i);
  });

  it('number coerces string -> number and rejects garbage', () => {
    const defs: TemplateVariable[] = [
      { key: 'count', label: 'count', type: 'number', required: true },
    ];
    expect(validateVariables(defs, { count: 5 })).toEqual({ count: 5 });
    expect(validateVariables(defs, { count: '7' })).toEqual({ count: 7 });
    expect(() => validateVariables(defs, { count: 'abc' })).toThrow(/number/i);
  });

  it('boolean coerces "true"/"false" and rejects anything else', () => {
    const defs: TemplateVariable[] = [
      { key: 'enabled', label: 'enabled', type: 'boolean', required: true },
    ];
    expect(validateVariables(defs, { enabled: true })).toEqual({ enabled: true });
    expect(validateVariables(defs, { enabled: 'true' })).toEqual({
      enabled: true,
    });
    expect(validateVariables(defs, { enabled: 'false' })).toEqual({
      enabled: false,
    });
    expect(() => validateVariables(defs, { enabled: 'yes' })).toThrow(/boolean/i);
  });

  it('falls back to default for missing optional', () => {
    const defs: TemplateVariable[] = [
      {
        key: 'depth',
        label: 'depth',
        type: 'select',
        options: ['基础', '标准'],
        default: '标准',
        required: false,
      },
    ];
    expect(validateVariables(defs, {})).toEqual({ depth: '标准' });
  });

  it('uses TemplateVariableError class', () => {
    const defs: TemplateVariable[] = [
      { key: 'x', label: 'x', type: 'text', required: true },
    ];
    let caught: unknown;
    try {
      validateVariables(defs, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TemplateVariableError);
  });
});
