/**
 * Public AI module surface (front-half).
 *
 * The router (Task 6) is intentionally NOT exported yet — Agent-C back-half
 * will mount /api/ai once Agent-B's NodeService/RelationService land.
 */
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
