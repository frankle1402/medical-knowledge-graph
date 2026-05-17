/**
 * Self-served smoke test for Agent-B's stack.
 *
 * Direct service-layer calls (no HTTP) so this is fast and easy to run on a
 * dev box. Agent-H will reuse the same flow over supertest.
 *
 * Run: `npm -w backend run smoke:graph`
 */
import { GraphService } from '../modules/graphs/graph.service.js';
import { NodeService } from '../modules/nodes/node.service.js';
import { RelationService } from '../modules/relations/relation.service.js';
import { closeDriver } from '../lib/neo4j.js';

async function main(): Promise<void> {
  // 1) Create graph
  // eslint-disable-next-line no-console
  console.log('1) create graph');
  const g = await GraphService.create({
    graph_name: 'smoke-' + Date.now(),
    graph_type: 'course',
    subject: '护理学',
    course_name: '基础护理学',
    created_by: '00000000-0000-0000-0000-000000000001',
  });

  // 2) Create two nodes
  // eslint-disable-next-line no-console
  console.log('2) create nodes');
  const a = await NodeService.create(g.graph_id, {
    node_type: 'knowledge_point',
    name: '心率监测',
    knowledge_type: '概念类',
    source: 'manual',
    status: 'approved',
  } as never);
  const b = await NodeService.create(g.graph_id, {
    node_type: 'knowledge_point',
    name: '血压测量',
    knowledge_type: '概念类',
    source: 'manual',
    status: 'approved',
  } as never);
  if (!a || !b) throw new Error('node create returned null');

  // 3) Create a relation
  // eslint-disable-next-line no-console
  console.log('3) create relation');
  const r = await RelationService.create(g.graph_id, {
    source_id: a.node_id as string,
    target_id: b.node_id as string,
    relation_type: 'RELATED_TO',
  });
  if (!r.relation_id) throw new Error('relation create missing id');

  // 4) List nodes
  // eslint-disable-next-line no-console
  console.log('4) list nodes');
  const list = await NodeService.list(g.graph_id, { skip: 0, limit: 50 });
  if (list.total !== 2) {
    throw new Error(`expected 2 nodes, got ${list.total}`);
  }

  // 5) Export
  // eslint-disable-next-line no-console
  console.log('5) export json');
  const exported = await GraphService.exportToJson(g.graph_id);
  if (
    !exported ||
    !exported.graph ||
    exported.nodes.length !== 2 ||
    exported.relations.length !== 1
  ) {
    throw new Error(
      `export shape mismatch: nodes=${exported?.nodes.length} rels=${exported?.relations.length}`,
    );
  }

  // 6) Cleanup
  // eslint-disable-next-line no-console
  console.log('6) cleanup');
  await GraphService.remove(g.graph_id);

  // eslint-disable-next-line no-console
  console.log('SMOKE PASS', g.graph_id);
}

const invokedDirectly = (() => {
  try {
    return (process.argv[1] ?? '').includes('smoke-graph');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('SMOKE FAIL:', err);
      process.exitCode = 1;
    })
    .finally(() => closeDriver());
}
