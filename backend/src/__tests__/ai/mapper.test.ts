import { describe, it, expect } from 'vitest';

import { LLMParseError } from '../../lib/llm/index.js';
import { parseLLMOutput } from '../../modules/ai/ai.llm.js';
import { mapLLMOutput } from '../../modules/ai/ai.mapper.js';

const sampleOutput = JSON.stringify({
  graph_name: '静脉输液',
  nodes: [
    {
      node_id: 'KP_001',
      node_type: 'knowledge_point',
      name: '静脉输液概念',
      knowledge_type: '概念类',
      confidence: 0.9,
    },
    {
      node_id: 'KP_002',
      node_type: 'knowledge_point',
      name: '静脉输液目的',
      knowledge_type: '目的类',
      confidence: 0.8,
    },
    {
      node_id: 'TM_001',
      node_type: 'term',
      name: '静脉输液',
      standard_term: '静脉输液',
      aliases: ['IV', 'intravenous infusion'],
    },
  ],
  relations: [
    {
      source_id: 'KP_001',
      target_id: 'KP_002',
      relation_type: 'PREREQUISITE_OF',
      confidence: 0.7,
    },
    {
      source_id: 'KP_001',
      target_id: 'TM_001',
      relation_type: 'STANDARD_TERM_OF',
    },
  ],
});

describe('parseLLMOutput', () => {
  it('parses valid JSON string into AIGenerateOutput', () => {
    const out = parseLLMOutput(sampleOutput);
    expect(out.graph_name).toBe('静脉输液');
    expect(out.nodes).toHaveLength(3);
    expect(out.relations).toHaveLength(2);
  });

  it('strips ```json ... ``` markdown fences', () => {
    const wrapped = '```json\n' + sampleOutput + '\n```';
    const out = parseLLMOutput(wrapped);
    expect(out.nodes).toHaveLength(3);
  });

  it('strips bare ``` fences', () => {
    const wrapped = '```\n' + sampleOutput + '\n```';
    expect(() => parseLLMOutput(wrapped)).not.toThrow();
  });

  it('throws LLMParseError on invalid JSON', () => {
    expect(() => parseLLMOutput('not-json')).toThrow(LLMParseError);
  });

  it('throws LLMParseError when schema is missing fields', () => {
    expect(() => parseLLMOutput('{"foo":1}')).toThrow(LLMParseError);
  });

  it('throws LLMParseError on empty content', () => {
    expect(() => parseLLMOutput('')).toThrow(LLMParseError);
    expect(() => parseLLMOutput('   ')).toThrow(LLMParseError);
  });

  it('attaches raw text to LLMParseError for diagnostics', () => {
    let caught: unknown;
    try {
      parseLLMOutput('not-json');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LLMParseError);
    expect((caught as LLMParseError).raw).toBe('not-json');
  });
});

describe('mapLLMOutput', () => {
  it('maps nodes preserving LLM-assigned node_id and type-specific fields', () => {
    const parsed = parseLLMOutput(sampleOutput);
    const mapped = mapLLMOutput(parsed);

    expect(mapped.nodes).toHaveLength(3);
    const kp1 = mapped.nodes[0] as Record<string, unknown>;
    expect(kp1.node_id).toBe('KP_001');
    expect(kp1.node_type).toBe('knowledge_point');
    expect(kp1.name).toBe('静脉输液概念');
    expect(kp1.knowledge_type).toBe('概念类');

    const tm1 = mapped.nodes[2] as Record<string, unknown>;
    expect(tm1.standard_term).toBe('静脉输液');
    expect(tm1.aliases).toEqual(['IV', 'intravenous infusion']);
  });

  it('keeps relations whose endpoints exist', () => {
    const parsed = parseLLMOutput(sampleOutput);
    const mapped = mapLLMOutput(parsed);
    expect(mapped.relations).toHaveLength(2);
    expect(mapped.relations[0]?.source_id).toBe('KP_001');
    expect(mapped.relations[0]?.target_id).toBe('KP_002');
  });

  it('drops dangling relations (referenced node not present) by default', () => {
    const bad = JSON.stringify({
      graph_name: 'x',
      nodes: [
        {
          node_id: 'KP_A',
          node_type: 'knowledge_point',
          name: 'a',
          knowledge_type: '概念类',
        },
      ],
      relations: [
        { source_id: 'KP_A', target_id: 'GHOST', relation_type: 'RELATED_TO' },
        { source_id: 'KP_A', target_id: 'KP_A', relation_type: 'RELATED_TO' },
      ],
    });
    const parsed = parseLLMOutput(bad);
    const mapped = mapLLMOutput(parsed);
    expect(mapped.relations).toHaveLength(1);
    expect(mapped.relations[0]?.target_id).toBe('KP_A');
  });

  it('keeps dangling relations when dropDanglingRelations=false', () => {
    const bad = JSON.stringify({
      graph_name: 'x',
      nodes: [
        {
          node_id: 'KP_A',
          node_type: 'knowledge_point',
          name: 'a',
          knowledge_type: '概念类',
        },
      ],
      relations: [
        { source_id: 'KP_A', target_id: 'GHOST', relation_type: 'RELATED_TO' },
      ],
    });
    const parsed = parseLLMOutput(bad);
    const mapped = mapLLMOutput(parsed, { dropDanglingRelations: false });
    expect(mapped.relations).toHaveLength(1);
  });

  it('exposes knownNodeIds for orchestrator validation', () => {
    const parsed = parseLLMOutput(sampleOutput);
    const mapped = mapLLMOutput(parsed);
    expect(mapped.knownNodeIds.has('KP_001')).toBe(true);
    expect(mapped.knownNodeIds.has('KP_002')).toBe(true);
    expect(mapped.knownNodeIds.has('TM_001')).toBe(true);
    expect(mapped.knownNodeIds.size).toBe(3);
  });
});
