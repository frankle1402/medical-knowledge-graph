/**
 * In-memory embedding queue for Pack C RAG.
 *
 * Design intent
 * -------------
 * Node writes (create / update / batch) must NOT block on OpenAI. We register
 * a fire-and-forget hook on `setNodeUpsertedHook` that drops jobs into a tiny
 * in-process FIFO queue. A single worker drains it serially.
 *
 * At-most-once semantics: if the worker crashes mid-job or the process
 * restarts, the affected node simply ends up with `embedding IS NULL`.
 * `backfill-embeddings.ts` is the bottom-of-the-stack guarantee — it picks
 * up any orphans on the next run.
 *
 * Skip-on-stale: when `was_created=false` (an update path) AND the embedding
 * text is unchanged from the last enqueued version, we skip the OpenAI call.
 * Useful when status flips ("candidate" → "approved") fire the hook but
 * don't change `name` / `description` / `tags`. We only cache the *last
 * enqueued text per node_id*; that's fine because the queue is per-process
 * and the cache lives alongside it. After a restart we'll re-embed once,
 * which is acceptable.
 *
 * Why a Set + FIFO array rather than a queue library:
 * - We need de-dup by node_id (don't enqueue the same node twice if updates
 *   arrive faster than the worker drains).
 * - Order doesn't strictly matter; FIFO is fine.
 * - No external dependency, no persistence story to maintain.
 */
import { prisma } from '../../lib/prisma.js';
import { setNodeUpsertedHook } from '../../modules/nodes/node.service.js';
import { embed, nodeEmbeddingText } from './openai.js';

interface Task {
  node_id: string;
  text: string;
}

const queue: Task[] = [];
const enqueued = new Set<string>();
const lastEmbeddedText = new Map<string, string>();

let running = false;
let inflightDone: Promise<void> = Promise.resolve();
let inflightResolve: () => void = () => {};

/**
 * Test-friendly stats. Updated only as a side-effect of run(); the real
 * embedding flow doesn't read them.
 */
export interface EmbeddingQueueStats {
  enqueued: number;
  succeeded: number;
  failed: number;
  skipped: number;
}
const stats: EmbeddingQueueStats = {
  enqueued: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
};

export function getEmbeddingQueueStats(): EmbeddingQueueStats {
  return { ...stats };
}

/**
 * Test helper: clears the queue, the seen-set, the last-text cache, and
 * resets stats. Does NOT detach the hook.
 */
export function _resetQueue(): void {
  queue.length = 0;
  enqueued.clear();
  lastEmbeddedText.clear();
  stats.enqueued = 0;
  stats.succeeded = 0;
  stats.failed = 0;
  stats.skipped = 0;
  running = false;
  inflightDone = Promise.resolve();
  inflightResolve = () => {};
}

/**
 * Resolves the next time the queue drains to empty. Lets tests await
 * background processing without polling.
 */
export function whenIdle(): Promise<void> {
  if (!running && queue.length === 0) return Promise.resolve();
  return inflightDone;
}

/**
 * Enqueue a node for embedding. Idempotent for an in-flight node_id; the
 * latest text wins if a re-enqueue arrives before the worker picks it up.
 */
export function enqueueEmbedding(node: {
  node_id: string;
  name: string;
  description?: string | null;
  tags?: unknown;
}): void {
  const text = nodeEmbeddingText(node);
  if (enqueued.has(node.node_id)) {
    // Update text in place — last write wins.
    const existing = queue.find((t) => t.node_id === node.node_id);
    if (existing) existing.text = text;
    return;
  }
  queue.push({ node_id: node.node_id, text });
  enqueued.add(node.node_id);
  stats.enqueued += 1;
  scheduleRun();
}

function scheduleRun(): void {
  if (running) return;
  running = true;
  inflightDone = new Promise((resolve) => {
    inflightResolve = resolve;
  });
  // Defer to the next microtask so writes complete before we start.
  Promise.resolve().then(() => void run());
}

async function run(): Promise<void> {
  try {
    while (queue.length > 0) {
      const task = queue.shift()!;
      enqueued.delete(task.node_id);
      try {
        const v = await embed(task.text);
        const literal = `[${v.join(',')}]`;
        // Use $executeRaw with parameter binding. The literal is parameterised
        // — only the cast `::vector` is part of the SQL fragment. Empty / NULL
        // node_id is impossible here; the hook filters those.
        await prisma.$executeRaw`UPDATE nodes SET embedding = ${literal}::vector WHERE node_id = ${task.node_id}`;
        lastEmbeddedText.set(task.node_id, task.text);
        stats.succeeded += 1;
      } catch (err) {
        stats.failed += 1;
        // Best-effort: failed nodes will be picked up by backfill-embeddings.
        // eslint-disable-next-line no-console
        console.error('[embedding-queue] failed for', task.node_id, err);
      }
    }
  } finally {
    running = false;
    const resolve = inflightResolve;
    inflightResolve = () => {};
    resolve();
  }
}

/**
 * Wire up the Pack B hook. Calling this twice is safe — it just replaces
 * the previous registration. Pass `null` to detach (used by tests).
 */
export function registerEmbeddingHook(): void {
  setNodeUpsertedHook((n) => {
    // Skip stale updates: an update where the embedding text didn't change.
    // For freshly created rows we always embed; for updates we compare to
    // the last successfully embedded text. If we have no record (first-time
    // update on a node we never embedded — e.g. process restart), fall
    // through and embed.
    const desc = n.description ?? null;
    if (!n.was_created) {
      const last = lastEmbeddedText.get(n.node_id);
      const next = nodeEmbeddingText({
        name: n.name,
        description: desc,
        tags: n.tags,
      });
      if (last !== undefined && last === next) {
        stats.skipped += 1;
        return;
      }
    }
    enqueueEmbedding({
      node_id: n.node_id,
      name: n.name,
      description: desc,
      tags: n.tags,
    });
  });
}

/** Detach the hook. Tests use this to keep state isolated. */
export function unregisterEmbeddingHook(): void {
  setNodeUpsertedHook(null);
}
