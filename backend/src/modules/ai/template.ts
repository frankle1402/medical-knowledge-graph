/**
 * Handlebars-based prompt template rendering.
 *
 * - Strict mode: any reference to an undefined variable throws.
 * - HTML escaping disabled by default (prompts are plain text, not HTML).
 * - Variables are validated/normalized BEFORE reaching this renderer; this
 *   module is a thin wrapper that turns a template string + values into the
 *   final user prompt.
 */

import Handlebars from 'handlebars';

import type { TemplateVariable } from '@mkg/shared';

import { validateVariables, type NormalizedVariables, type VariableInput } from './variables.js';

export class TemplateRenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'TemplateRenderError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

interface CompileOptions {
  /** strict mode throws on missing variables. Default true. */
  strict?: boolean;
  /** noEscape: disable HTML escaping. Default true (we render prompts, not HTML). */
  noEscape?: boolean;
}

/**
 * Compile and run a Handlebars template against pre-normalized variables.
 *
 * Throws TemplateRenderError when:
 * - the template is syntactically invalid
 * - strict mode is on and the template references an undefined name
 */
export function renderTemplate(
  template: string,
  values: NormalizedVariables,
  options: CompileOptions = {},
): string {
  const strict = options.strict ?? true;
  const noEscape = options.noEscape ?? true;

  let compiled: Handlebars.TemplateDelegate;
  try {
    compiled = Handlebars.compile(template, { strict, noEscape });
  } catch (err) {
    throw new TemplateRenderError(
      `Failed to compile template: ${(err as Error).message}`,
      { cause: err },
    );
  }

  try {
    return compiled(values);
  } catch (err) {
    throw new TemplateRenderError(
      `Failed to render template: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

/**
 * Convenience: validate variables against the template's variable definitions
 * and then render the template in one step.
 *
 * This is the canonical entry point used by the orchestrator.
 */
export function renderPrompt(args: {
  template: string;
  variableDefs: TemplateVariable[];
  input: Record<string, VariableInput | undefined | null>;
}): { prompt: string; values: NormalizedVariables } {
  const values = validateVariables(args.variableDefs, args.input);
  const prompt = renderTemplate(args.template, values);
  return { prompt, values };
}
