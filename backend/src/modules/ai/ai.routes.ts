/**
 * AI generation routes (Agent-C back-half).
 *
 * Mounted at `/api/ai`. Endpoints (OpenAPI registry, 5 paths):
 *
 *   POST /api/ai/generate                        operator/expert/admin
 *   GET  /api/ai/jobs/:jobId                     any auth
 *   POST /api/ai/jobs/:jobId/approve             expert/admin
 *   POST /api/ai/jobs/:jobId/approve-all         expert/admin
 *   POST /api/ai/jobs/:jobId/reject-all          expert/admin
 *
 * Generation runs fire-and-forget — the route returns a `running` job_id
 * immediately after the ai_generation_logs row is inserted. The orchestrator
 * (sync mode, no queue) runs in the background and updates the row to
 * `success`/`failed`. The frontend polls GET /api/ai/jobs/:jobId.
 *
 * Approve / reject endpoints require the job to be in `success` status
 * (otherwise 409 JOB_NOT_SUCCEEDED). Reject deletes candidate nodes and
 * relations physically; approve flips status to `approved`.
 *
 * RELATIONS BULK-BY-IDS: Agent-B's RelationService delivered
 * bulkUpdateStatusByJob / bulkDeleteByJob but NOT bulkUpdateStatusByIds.
 * Until Agent-B ships that method, partial relation approval falls back
 * to per-relation updates via RelationService.update.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  AIGenerateRequest,
  ApproveBody,
  type AIJob,
  type AIJobOutput,
} from '@mkg/shared';

import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { NodeService } from '../nodes/node.service.js';
import { RelationService } from '../relations/relation.service.js';
import { GraphService } from '../graphs/graph.service.js';
import { logger } from '../../lib/logger.js';

import { AIJobOrchestrator } from './ai.orchestrator.js';

// Agent-B's NodeService / RelationService expose `createBatch(graph, items, opts)`
// while the orchestrator's NodeServicePort / RelationServicePort expose
// `bulkCreate(graph, items, defaults)`. Adapt at the seam — the runtime
// shapes are compatible; only the method name + opts/defaults vocabulary
// differ. RelationService.createBatch returns a count rather than rows;
// the orchestrator only cares about `.length`, so we synthesize stub rows.
const nodeServiceAdapter = {
  async bulkCreate(
    graphId: string,
    nodes: ReadonlyArray<Record<string, unknown>>,
    defaults: { status: 'candidate'; source: 'ai_generated'; ai_job_id: string },
  ): Promise<Array<Record<string, unknown>>> {
    return NodeService.createBatch(
      graphId,
      nodes as Array<Record<string, unknown>>,
      defaults,
    );
  },
};

const relationServiceAdapter = {
  async bulkCreate(
    graphId: string,
    relations: ReadonlyArray<Record<string, unknown>>,
    defaults: { status: 'candidate'; source: 'ai_generated'; ai_job_id: string },
  ): Promise<Array<Record<string, unknown>>> {
    const written = await RelationService.createBatch(
      graphId,
      relations as never,
      defaults,
    );
    // Synthesize length-bearing rows so the orchestrator's `.length` count
    // matches what was actually written. Identity of each entry is not
    // observable by callers — they only count the array.
    return Array.from({ length: written }, () => ({}));
  },
};

const orchestrator = new AIJobOrchestrator({
  prisma,
  nodeService: nodeServiceAdapter as never,
  relationService: relationServiceAdapter as never,
});

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function loadSucceededLog(jobId: string) {
  const log = await prisma.aiGenerationLog.findUnique({ where: { id: jobId } });
  if (!log) {
    throw new HttpError(404, 'NOT_FOUND', 'job not found');
  }
  if (log.status !== 'success') {
    throw new HttpError(
      409,
      'JOB_NOT_SUCCEEDED',
      `job status=${log.status} (must be success to approve/reject)`,
    );
  }
  if (!log.graph_id) {
    throw new HttpError(409, 'JOB_NOT_SUCCEEDED', 'job has no graph_id');
  }
  return log;
}

async function updateRelationsByIds(
  relationIds: string[],
  status: 'approved' | 'rejected' | 'candidate',
): Promise<number> {
  if (relationIds.length === 0) return 0;
  let updated = 0;
  for (const id of relationIds) {
    try {
      const row = await RelationService.update(id, { status });
      if (row) updated += 1;
    } catch (err) {
      logger.warn(
        { err, relation_id: id },
        'updateRelationsByIds: skipping invalid relation_id',
      );
    }
  }
  return updated;
}

async function resolveGraphId(
  body: { graph_id?: string },
  templateName: string,
  userId: string,
): Promise<string> {
  if (body.graph_id) return body.graph_id;
  const created = await GraphService.create({
    graph_name: `AI-${templateName}-${Date.now()}`,
    graph_type: 'course',
    description: 'Auto-created by AI generation',
    created_by: userId,
  });
  return created.graph_id;
}

export const aiRouter: Router = Router();
aiRouter.use(requireAuth);

// =====================================================================
// POST /api/ai/generate
// Body: AIGenerateRequest = { template_id, variables, graph_id? }
// Resp: { job_id, status: 'running' }   (fire-and-forget; poll the GET)
// =====================================================================
aiRouter.post(
  '/generate',
  requireRole('operator', 'expert', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = AIGenerateRequest.parse(req.body);
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const tpl = await prisma.promptTemplate.findFirst({
        where: { id: body.template_id, is_active: true, deleted_at: null },
      });
      if (!tpl) {
        res
          .status(404)
          .json({ error: 'template_not_found', code: 'NOT_FOUND' });
        return;
      }

      const graphId = await resolveGraphId(
        body.graph_id ? { graph_id: body.graph_id } : {},
        tpl.name,
        userId,
      );

      const { jobId, done } = await orchestrator.start({
        template: {
          id: tpl.id,
          system_prompt: tpl.system_prompt,
          user_prompt_template: tpl.user_prompt_template,
          // Prisma JSON column → TemplateVariable[]; the orchestrator's
          // variable validator runtime-checks each entry before LLM call.
          variables: tpl.variables as never,
        },
        variables: body.variables,
        graphId,
        userId,
      });

      // Detach the background promise so unhandled rejections don't
      // kill the process; the orchestrator persists status=failed.
      done.catch((err) => {
        logger.error({ err, jobId }, 'AI generation job failed');
      });

      res.status(202).json({ job_id: jobId, status: 'running' });
    } catch (e) {
      next(e);
    }
  },
);

// =====================================================================
// GET /api/ai/jobs/:jobId
// Resp: AIJob = { job_id, status, graph_id?, output?, error?, created_at? }
// =====================================================================
aiRouter.get(
  '/jobs/:jobId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.jobId ?? '';
      const log = await prisma.aiGenerationLog.findUnique({
        where: { id: jobId },
      });
      if (!log) {
        res.status(404).json({ error: 'job_not_found', code: 'NOT_FOUND' });
        return;
      }

      // The shared AIJobStatus enum uses 'success'/'failed'/'running'/
      // 'pending'/'partial' — we store the same strings in Postgres.
      const status = log.status as AIJob['status'];

      let output: AIJobOutput | undefined;
      if (status === 'success' && log.graph_id) {
        try {
          const nodes = await NodeService.listByAiJob(log.graph_id, log.id);
          // Agent-B has not yet shipped RelationService.listByAiJob. Until
          // that lands, we leave relations as an empty list — the
          // candidate relations are still queryable by ai_job_id from the
          // existing graph endpoints.
          output = {
            nodes: nodes as unknown as AIJobOutput['nodes'],
            relations: [] as AIJobOutput['relations'],
          };
        } catch (err) {
          logger.warn(
            { err, jobId },
            'listByAiJob failed (Neo4j down?) — returning job without output',
          );
        }
      }

      const payload: AIJob = {
        job_id: log.id,
        status,
        ...(log.graph_id ? { graph_id: log.graph_id } : {}),
        ...(output ? { output } : {}),
        ...(log.error_msg ? { error: log.error_msg } : {}),
        ...(log.created_at
          ? { created_at: log.created_at.toISOString() }
          : {}),
      };
      res.json(payload);
    } catch (e) {
      next(e);
    }
  },
);

// =====================================================================
// POST /api/ai/jobs/:jobId/approve-all
// Resp: { ok: true, nodes: number, relations: number }
// =====================================================================
aiRouter.post(
  '/jobs/:jobId/approve-all',
  requireRole('expert', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const log = await loadSucceededLog(req.params.jobId ?? '');
      const nodes = await NodeService.bulkUpdateStatusByJob(
        log.graph_id!,
        log.id,
        'approved',
      );
      const relations = await RelationService.bulkUpdateStatusByJob(
        log.graph_id!,
        log.id,
        'approved',
      );
      res.json({ ok: true, nodes, relations });
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message, code: e.code });
        return;
      }
      next(e);
    }
  },
);

// =====================================================================
// POST /api/ai/jobs/:jobId/approve
// Body: ApproveBody = { node_ids[], relation_ids[] }
// Resp: { ok: true, nodes: number, relations: number }
// =====================================================================
aiRouter.post(
  '/jobs/:jobId/approve',
  requireRole('expert', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = ApproveBody.parse(req.body ?? {});
      const log = await loadSucceededLog(req.params.jobId ?? '');
      const nodes = await NodeService.bulkUpdateStatusByIds(
        log.graph_id!,
        body.node_ids,
        'approved',
      );
      const relations = await updateRelationsByIds(
        body.relation_ids,
        'approved',
      );
      res.json({ ok: true, nodes, relations });
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message, code: e.code });
        return;
      }
      next(e);
    }
  },
);

// =====================================================================
// POST /api/ai/jobs/:jobId/reject-all
// Resp: { ok: true, nodes: number, relations: number }
//   (numbers = how many rows physically deleted)
// =====================================================================
aiRouter.post(
  '/jobs/:jobId/reject-all',
  requireRole('expert', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const log = await loadSucceededLog(req.params.jobId ?? '');
      // Order matters: relations reference nodes via DETACH DELETE on the
      // node side, but explicitly clearing relations first keeps the
      // counts honest in case Cypher's MATCH expansion changes.
      const relations = await RelationService.bulkDeleteByJob(
        log.graph_id!,
        log.id,
      );
      const nodes = await NodeService.bulkDeleteByJob(log.graph_id!, log.id);
      res.json({ ok: true, nodes, relations });
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message, code: e.code });
        return;
      }
      next(e);
    }
  },
);
