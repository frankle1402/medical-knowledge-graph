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
import { renderPrompt } from './template.js';
import type { VariableInput } from './variables.js';
import type { RetryOptions } from '../../lib/llm/index.js';

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
   * End-to-end AI generation:
   *
   *  1. Insert ai_generation_logs row (status=running).
   *  2. Validate + render prompt.
   *  3. Call LLM with retry → parse + zod validate → map.
   *  4. Persist candidates via NodeService.bulkCreate / RelationService.bulkCreate.
   *  5. Update ai_generation_logs row (status=success | failed).
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
        },
        ...(this.retryOptions ? { retry: this.retryOptions } : {}),
      });
      raw = llmRaw;

      const mapped: MappedCandidates = mapLLMOutput(output);

      const defaults = {
        status: 'candidate' as const,
        source: 'ai_generated' as const,
        ai_job_id: log.id,
      };

      const createdNodes = await this.nodeService.bulkCreate(
        input.graphId,
        mapped.nodes,
        defaults,
      );
      const createdRelations = await this.relationService.bulkCreate(
        input.graphId,
        mapped.relations,
        defaults,
      );

      await this.prisma.aiGenerationLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          prompt_used: prompt,
          llm_response: raw,
          nodes_created: createdNodes.length,
          relations_created: createdRelations.length,
        },
      });

      return {
        jobId: log.id,
        status: 'success',
        nodesCreated: createdNodes.length,
        relationsCreated: createdRelations.length,
        graphName: output.graph_name,
        output,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.prisma.aiGenerationLog.update({
          where: { id: log.id },
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
