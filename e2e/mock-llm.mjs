// Minimal OpenAI-compatible Chat Completions stub.
//
// Run as a standalone process:
//
//   node mock-llm.mjs            # default port 9999
//   MOCK_LLM_PORT=9000 node ...  # custom port
//
// Returns a fixed AIGenerateOutput JSON in `choices[0].message.content`.
// The orchestrator passes this through Zod validation, so the shape must match
// shared `AIGenerateOutput` (graph_name + nodes[] with node_id, name, node_type
// + relations[] with source_id, target_id, relation_type).
import http from 'node:http';

const FIXED_GRAPH = {
  graph_name: 'E2E AI 测试图谱',
  nodes: [
    {
      node_id: 'KP_1',
      node_type: 'knowledge_point',
      name: '静脉输液',
      knowledge_type: '概念类',
      description: '将药液经静脉持续滴入',
      confidence: 0.95,
    },
    {
      node_id: 'KP_2',
      node_type: 'knowledge_point',
      name: '输血反应',
      knowledge_type: '并发症类',
      description: '常见免疫性反应',
      confidence: 0.93,
    },
    {
      node_id: 'OP_1',
      node_type: 'operation_step',
      name: '排气',
      description: '排尽输液管中空气',
      confidence: 0.99,
      step_order: 1,
      phase: '准备阶段',
    },
    {
      node_id: 'TM_1',
      node_type: 'term',
      name: '肝素帽',
      description: '一次性密闭装置',
      confidence: 0.97,
      standard_term: '肝素帽',
      aliases: [],
    },
  ],
  relations: [
    { source_id: 'KP_1', target_id: 'OP_1', relation_type: 'CONTAINS' },
    { source_id: 'KP_1', target_id: 'KP_2', relation_type: 'RELATED_TO' },
    { source_id: 'KP_1', target_id: 'TM_1', relation_type: 'APPLIED_IN' },
  ],
};

const port = Number(process.env.MOCK_LLM_PORT ?? 9999);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // Log every hit so test runs can confirm backend really called us
      // (vs. accidentally hitting the real OpenAI endpoint).
      // eslint-disable-next-line no-console
      console.log(`[mock-llm] received ${body.length} bytes`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'mock-' + Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify(FIXED_GRAPH),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
          },
        }),
      );
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-llm] listening on http://127.0.0.1:${port}`);
});
