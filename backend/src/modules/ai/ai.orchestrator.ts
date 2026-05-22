/**
 * AI Job orchestrator (sync mode, no queue).
 *
 * Front-half (Agent-C) responsibility — wire prompt → LLM → parse → map →
 * persist log → call NodeService/RelationService. Back-half (Task 6+) will
 * mount this behind /api/ai/generate and add /jobs/:id read endpoints.
 *
 * NOTE: NodeService / RelationService are DI'd because Agent-B is building
 * those modules in parallel. This file does NOT import their concrete classes.
 * Tests inject stubs; the back-half wiring will inject the real services.
 */

import type { PrismaClient } from '@prisma/client';
import {
  type AIGenerateOutput,
  type NodeCreateInput,
  type RelationCreateInput,
  type PromptTemplate,
  type TemplateVariable,
  type Node as SharedNode,
  type Relation as SharedRelation,
} from '@mkg/shared';

import { generateStructured } from './ai.llm.js';
import { mapLLMOutput, type MappedCandidates } from './ai.mapper.js';
import {
  postprocess,
  type PostprocessNode,
  type PostprocessRelation,
} from './postprocessor.js';
import { renderPrompt } from './template.js';
import type { VariableInput } from './variables.js';
import type { RetryOptions } from '../../lib/llm/index.js';
import { LLMParseError } from '../../lib/llm/index.js';

/**
 * The minimal slice of NodeService that the orchestrator needs.
 * Agent-B's full NodeService will be a superset of this interface.
 */
export interface NodeServicePort {
  bulkCreate(
    graphId: string,
    nodes: NodeCreateInput[],
    defaults: { status: 'candidate'; source: 'ai_generated'; ai_job_id: string },
  ): Promise<SharedNode[]>;
}

export interface RelationServicePort {
  bulkCreate(
    graphId: string,
    relations: RelationCreateInput[],
    defaults: { status: 'candidate'; source: 'ai_generated'; ai_job_id: string },
  ): Promise<SharedRelation[]>;
}

/** PrismaClient slice the orchestrator needs (just aiGenerationLog CRUD). */
export type PrismaPort = Pick<PrismaClient, 'aiGenerationLog'>;

export interface AIJobOrchestratorDeps {
  prisma: PrismaPort;
  nodeService: NodeServicePort;
  relationService: RelationServicePort;
  /** Defaults to the live OpenAI-compatible client. Test-only override. */
  llm?: typeof generateStructured;
  /** Retry options forwarded into the LLM call. */
  retryOptions?: RetryOptions;
}

export interface GenerateInput {
  template: Pick<
    PromptTemplate,
    'id' | 'system_prompt' | 'user_prompt_template' | 'variables'
  >;
  variables: Record<string, VariableInput | undefined | null>;
  graphId: string;
  userId: string;
}

export interface GenerateResult {
  jobId: string;
  status: 'success' | 'failed';
  nodesCreated: number;
  relationsCreated: number;
  graphName: string;
  output?: AIGenerateOutput;
  error?: string;
}

/**
 * AIJobOrchestrator wires the AI generation flow end-to-end.
 *
 * Construction:
 *   new AIJobOrchestrator({ prisma, nodeService, relationService, llm?, retryOptions? })
 *
 * The back-half (Agent-C Task 6+) will instantiate this with the real
 * Agent-A `prisma` singleton and Agent-B's `NodeService`/`RelationService`
 * implementations:
 *   // TODO Agent-C 后段：注入 Agent-B 的 NodeService / RelationService
 */
export class AIJobOrchestrator {
  private readonly prisma: PrismaPort;
  private readonly nodeService: NodeServicePort;
  private readonly relationService: RelationServicePort;
  private readonly llm: typeof generateStructured;
  private readonly retryOptions: RetryOptions | undefined;

  constructor(deps: AIJobOrchestratorDeps) {
    this.prisma = deps.prisma;
    this.nodeService = deps.nodeService;
    this.relationService = deps.relationService;
    this.llm = deps.llm ?? generateStructured;
    this.retryOptions = deps.retryOptions;
  }

  /**
   * End-to-end AI generation (synchronous, blocking).
   *
   *  1. Insert ai_generation_logs row (status=running).
   *  2. Validate + render prompt.
   *  3. Call LLM with retry → parse + zod validate → map.
   *  4. Persist candidates via NodeService.bulkCreate / RelationService.bulkCreate.
   *  5. Update ai_generation_logs row (status=success | failed).
   *
   * Tests + back-half code use this. The HTTP route prefers `start()` (below)
   * which returns the jobId immediately and runs the rest in the background.
   */
  async generate(input: GenerateInput): Promise<GenerateResult> {
    const log = await this.prisma.aiGenerationLog.create({
      data: {
        graph_id: input.graphId,
        template_id: input.template.id,
        user_id: input.userId,
        status: 'running',
        prompt_used: '',
        llm_response: '',
      },
    });

    return this.runWithLog(log.id, input);
  }

  /**
   * Fire-and-forget entry point used by `POST /api/ai/generate`.
   *
   * Synchronously creates the ai_generation_logs row (status=running) and
   * returns the new jobId. The actual LLM call + persistence runs on the
   * returned `done` promise; callers may either await it (tests) or attach
   * `.catch(...)` to swallow errors (HTTP route).
   *
   * On the LLM side, errors that escape `runWithLog` are already persisted
   * as status=failed before the promise rejects, so the caller can safely
   * ignore the rejection.
   */
  async start(
    input: GenerateInput,
  ): Promise<{ jobId: string; done: Promise<GenerateResult> }> {
    const log = await this.prisma.aiGenerationLog.create({
      data: {
        graph_id: input.graphId,
        template_id: input.template.id,
        user_id: input.userId,
        status: 'running',
        prompt_used: '',
        llm_response: '',
      },
    });

    const done = this.runWithLog(log.id, input);
    return { jobId: log.id, done };
  }

  /**
   * Shared inner pipeline: render prompt → LLM → map → persist candidates →
   * update the log row. Throws on any failure; the log row is updated to
   * status=failed before the throw propagates.
   */
  private async runWithLog(
    logId: string,
    input: GenerateInput,
  ): Promise<GenerateResult> {
    let prompt = '';
    let raw = '';

    try {
      const variableDefs = input.template.variables as TemplateVariable[];
      const rendered = renderPrompt({
        template: input.template.user_prompt_template,
        variableDefs,
        input: input.variables,
      });
      prompt = rendered.prompt;

      const { raw: llmRaw, output } = await this.llm({
        chat: {
          system: input.template.system_prompt,
          user: prompt,
          responseFormat: 'json_object',
          // Graph generation routinely emits 30–80 nodes + relations as JSON.
          // OpenAI-compatible gateways often default max_tokens to 1024–4096
          // and will silently truncate. Medical KG v2 prompts produce up to
          // 15k+ chars (~6k tokens); 32768 covers Claude Opus/Sonnet 4.x limits.
          maxTokens: 32768,
        },
        ...(this.retryOptions ? { retry: this.retryOptions } : {}),
      });
      raw = llmRaw;

      const mapped: MappedCandidates = mapLLMOutput(output);

      // Postprocess: fill NEXT_STEP from step_order, dedup symmetric relations,
      // warn on RELATED_TO overuse. Pure function; warnings flow into the
      // ai_generation_logs.error_msg payload below (success status still).
      const post = postprocess({
        nodes: mapped.nodes as PostprocessNode[],
        relations: mapped.relations as PostprocessRelation[],
      });
      const warningSuffix = post.warnings.length
        ? `[postprocessor warnings]\n${post.warnings.join('\n')}`
        : '';

      const defaults = {
        status: 'candidate' as const,
        source: 'ai_generated' as const,
        ai_job_id: logId,
      };

      const createdNodes = await this.nodeService.bulkCreate(
        input.graphId,
        post.nodes,
        defaults,
      );
      const createdRelations = await this.relationService.bulkCreate(
        input.graphId,
        post.relations,
        defaults,
      );

      await this.prisma.aiGenerationLog.update({
        where: { id: logId },
        data: {
          status: 'success',
          prompt_used: prompt,
          llm_response: raw,
          nodes_created: createdNodes.length,
          relations_created: createdRelations.length,
          error_msg: warningSuffix || null,
        },
      });

      return {
        jobId: logId,
        status: 'success',
        nodesCreated: createdNodes.length,
        relationsCreated: createdRelations.length,
        graphName: output.graph_name,
        output,
      };
    } catch (err) {
      // Surface the raw LLM body when parse / schema validation fails so the
      // failed job in the log table is debuggable. Without this, admins see
      // only the zod error and have no way to view what the model actually
      // returned (the most common failure mode is the model omitting a
      // required field on a few of many nodes).
      if (err instanceof LLMParseError && typeof err.raw === 'string' && err.raw.length > 0) {
        raw = err.raw;
      }
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.prisma.aiGenerationLog.update({
          where: { id: logId },
          data: {
            status: 'failed',
            prompt_used: prompt,
            llm_response: raw,
            error_msg: message,
          },
        });
      } catch {
        // swallow — original error matters more than the bookkeeping failure.
      }
      throw err;
    }
  }
}
