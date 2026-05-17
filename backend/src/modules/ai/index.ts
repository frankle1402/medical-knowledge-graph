/**
 * Public AI module surface.
 *
 * Front-half (Tasks 1-5) shipped the orchestrator + LLM/template/mapper
 * primitives. Back-half (Tasks 6-11) ships the HTTP router (`aiRouter`)
 * and is mounted by `app.ts` at `/api/ai`.
 */
export { aiRouter } from './ai.routes.js';

export {
  AIJobOrchestrator,
  type AIJobOrchestratorDeps,
  type GenerateInput,
  type GenerateResult,
  type NodeServicePort,
  type RelationServicePort,
  type PrismaPort,
} from './ai.orchestrator.js';

export { generateStructured, parseLLMOutput } from './ai.llm.js';
export { mapLLMOutput, type MappedCandidates, type MapOptions } from './ai.mapper.js';
export {
  renderPrompt,
  renderTemplate,
  TemplateRenderError,
} from './template.js';
export {
  validateVariables,
  TemplateVariableError,
  type NormalizedVariables,
  type VariableInput,
} from './variables.js';
