/**
 * Variable validation against TemplateVariable[] definitions.
 *
 * Five canonical types (review-report aligned): text | textarea | select | number | boolean.
 *
 * Returns a normalized record where all values are JS primitives suitable to
 * pass into the Handlebars renderer (text/textarea -> string, number -> number,
 * boolean -> boolean, select -> string).
 */

import type { TemplateVariable } from '@mkg/shared';

export type VariableInput = string | number | boolean;
export type NormalizedVariables = Record<string, string | number | boolean>;

export class TemplateVariableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateVariableError';
  }
}

function coerceNumber(key: string, raw: VariableInput): number {
  if (typeof raw === 'number') {
    if (Number.isNaN(raw)) {
      throw new TemplateVariableError(`Variable ${key} must be a number`);
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n)) {
      throw new TemplateVariableError(`Variable ${key} must be a number, got: ${raw}`);
    }
    return n;
  }
  throw new TemplateVariableError(`Variable ${key} must be a number, got boolean`);
}

function coerceBoolean(key: string, raw: VariableInput): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new TemplateVariableError(
    `Variable ${key} must be a boolean (true|false), got: ${String(raw)}`,
  );
}

/**
 * Validates input against the template's variable definitions.
 *
 * Behavior:
 * - required + missing/empty -> throws TemplateVariableError
 * - missing optional -> falls back to def.default; if no default, omitted
 * - select -> must be one of options
 * - number/boolean -> coerced into native type
 * - text/textarea -> stringified
 */
export function validateVariables(
  defs: TemplateVariable[],
  input: Record<string, VariableInput | undefined | null>,
): NormalizedVariables {
  const out: NormalizedVariables = {};

  for (const def of defs) {
    const provided = input[def.key];
    let raw: VariableInput | undefined =
      provided === undefined || provided === null ? undefined : provided;

    // empty string for text counts as missing
    if (typeof raw === 'string' && raw.length === 0) {
      raw = undefined;
    }

    if (raw === undefined && def.default !== undefined) {
      raw = def.default;
    }

    if (raw === undefined) {
      if (def.required) {
        throw new TemplateVariableError(`Required variable missing: ${def.key}`);
      }
      continue;
    }

    switch (def.type) {
      case 'text':
      case 'textarea': {
        out[def.key] = String(raw);
        break;
      }
      case 'select': {
        const str = String(raw);
        if (!def.options || def.options.length === 0) {
          throw new TemplateVariableError(
            `Select variable ${def.key} has no options defined`,
          );
        }
        if (!def.options.includes(str)) {
          throw new TemplateVariableError(
            `Variable ${def.key} value "${str}" is not in allowed options: ${def.options.join(', ')}`,
          );
        }
        out[def.key] = str;
        break;
      }
      case 'number': {
        out[def.key] = coerceNumber(def.key, raw);
        break;
      }
      case 'boolean': {
        out[def.key] = coerceBoolean(def.key, raw);
        break;
      }
      default: {
        // exhaustiveness guard
        const _never: never = def.type;
        throw new TemplateVariableError(`Unsupported variable type: ${String(_never)}`);
      }
    }
  }

  return out;
}
