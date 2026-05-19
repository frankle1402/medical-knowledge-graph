/**
 * Pack C — backfill missing embeddings.
 *
 * Why this exists
 * ---------------
 * The runtime path uses an at-most-once in-process queue: if the worker
 * crashes mid-job, or the process restarts before draining, or a single
 * embed() call fails, the affected node ends up with embedding IS NULL.
 *
 * Migration (Pack A) also lands rows without embeddings. This script is the
 * bottom-of-the-stack guarantee: it walks `nodes WHERE embedding IS NULL`,
 * batches them, calls `embeddings.create` once per batch (cheaper than per-
 * row), and writes the vectors back via `$executeRaw`.
 *
 * Run via `npm -w backend run backfill:embeddings`. Idempotent — already
 * embedded rows are filtered out by the WHERE clause, so re-running just
 * means "pick up where we left off".
 *
 * Failure semantics
 * -----------------
 * - Per-batch try/catch. A failed batch increments `failed` and the script
 *   keeps going; subsequent batches still get their chance. The failed rows
 *   stay NULL and will be picked up on the next invocation.
 * - We don't re-shape the input on failure or retry within the script. The
 *   queue / a future cron handles temporal retry.
 */
import { prisma } from '../lib/prisma.js';
import { embedBatch, nodeEmbeddingText } from '../services/embedding/openai.js';

/** OpenAI's hard limit on `inputs` per embeddings.create is ~2048; 100 is a
 * comfortable middle ground that keeps prompt tokens manageable. */
const DEFAULT_BATCH_SIZE = 100;

export interface BackfillStats {
  scanned: number;
  embedded: number;
  failed: number;
  skipped_empty: number;
}

interface BackfillOptions {
  /** Stop after this many rows. Useful for smoke runs / budget caps. */
  limit?: number;
  /** Override the default batch size. */
  batchSize?: number;
  /** Optional progress callback fired per batch (for the CLI / tests). */
  onBatch?: (info: { batchIndex: number; embedded: number; failed: number }) => void;
}

/**
 * Walk all nodes with `embedding IS NULL` and embed them in batches.
 * Returns aggregate stats.
 */
export async function backfillEmbeddings(
  opts: BackfillOptions = {},
): Promise<BackfillStats> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const stats: BackfillStats = {
    scanned: 0,
    embedded: 0,
    failed: 0,
    skipped_empty: 0,
  };

  let cursor: string | undefined = undefined;
  let batchIndex = 0;
  let remaining = opts.limit ?? Number.POSITIVE_INFINITY;

  // We page by `node_id` ASC. Cheaper than OFFSET on large tables and the
  // ordering is stable because node_id has a unique index.
  while (remaining > 0) {
    const take = Math.min(batchSize, remaining);
    // `embedding` is Prisma.Unsupported, so we can't put it in a where clause
    // via the typed client. Drop to $queryRaw for the page query — same
    // index-friendly cursor ordering.
    const rows: Array<{
      node_id: string;
      name: string;
      description: string | null;
      tags: unknown;
    }> = cursor === undefined
      ? await prisma.$queryRaw`
          SELECT node_id, name, description, tags
          FROM nodes
          WHERE embedding IS NULL
          ORDER BY node_id ASC
          LIMIT ${take}
        `
      : await prisma.$queryRaw`
          SELECT node_id, name, description, tags
          FROM nodes
          WHERE embedding IS NULL AND node_id > ${cursor}
          ORDER BY node_id ASC
          LIMIT ${take}
        `;

    if (rows.length === 0) break;

    stats.scanned += rows.length;
    cursor = rows[rows.length - 1]!.node_id;
    remaining -= rows.length;

    // Build embedding text for each row. Skip rows whose computed text is
    // empty — they have nothing to embed, and OpenAI would 400 anyway.
    const texts: string[] = [];
    const ids: string[] = [];
    for (const r of rows) {
      const t = nodeEmbeddingText(r);
      if (!t || t.trim().length === 0) {
        stats.skipped_empty += 1;
        continue;
      }
      texts.push(t);
      ids.push(r.node_id);
    }
    if (texts.length === 0) {
      opts.onBatch?.({ batchIndex, embedded: 0, failed: 0 });
      batchIndex += 1;
      continue;
    }

    let batchEmbedded = 0;
    let batchFailed = 0;
    try {
      const vecs = await embedBatch(texts);
      // Write each vector back. Could be a single CTE update, but keeping
      // it row-at-a-time keeps the SQL trivial and avoids fighting Prisma
      // over `vector` parameter binding for arrays.
      for (let i = 0; i < ids.length; i++) {
        const lit = `[${vecs[i]!.join(',')}]`;
        await prisma.$executeRaw`UPDATE nodes SET embedding = ${lit}::vector WHERE node_id = ${ids[i]!}`;
        batchEmbedded += 1;
      }
    } catch (err) {
      batchFailed = ids.length;
      // eslint-disable-next-line no-console
      console.error('[backfill] batch failed', { batchIndex, size: ids.length, err });
    }
    stats.embedded += batchEmbedded;
    stats.failed += batchFailed;
    opts.onBatch?.({ batchIndex, embedded: batchEmbedded, failed: batchFailed });
    batchIndex += 1;

    // If the page was smaller than `take`, we're done.
    if (rows.length < take) break;
  }

  return stats;
}

// CLI entrypoint — `npm -w backend run backfill:embeddings`.
if (
  process.argv[1]?.endsWith('backfill-embeddings.ts') ||
  process.argv[1]?.endsWith('backfill-embeddings.js')
) {
  backfillEmbeddings()
    .then((stats) => {
      // eslint-disable-next-line no-console
      console.log('backfill done:', stats);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
