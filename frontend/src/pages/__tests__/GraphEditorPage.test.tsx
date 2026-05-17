import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { GraphEditorPage } from '../GraphEditorPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useGraphStore } from '../../stores';

// react-flow uses ResizeObserver and DOMRect; jsdom needs both.
vi.mock('reactflow', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'mock-rf' }, children),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
    applyNodeChanges: (_c: unknown, prev: unknown) => prev,
    applyEdgeChanges: (_c: unknown, prev: unknown) => prev,
  };
});

const sampleGraph = {
  graph: {
    graph_id: 'graph_one',
    graph_name: '生理学',
    graph_type: 'course',
    status: 'active',
    node_count: 1,
    relation_count: 0,
  },
  nodes: [
    {
      node_id: 'KP_A',
      node_type: 'knowledge_point',
      name: '心率',
      status: 'approved',
      confidence: 1,
      source: 'manual',
      knowledge_type: '概念类',
      tags: [],
    },
  ],
  relations: [],
};

describe('GraphEditorPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useGraphStore.getState().reset();
  });

  it('loads graph detail and renders header with node count', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/graphs/graph_one')) {
        return new Response(JSON.stringify(sampleGraph), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/graphs/:id" element={<GraphEditorPage />} />
      </Routes>,
      { route: '/graphs/graph_one' },
    );

    await screen.findByText('生理学');
    expect(screen.getByText(/1 节点/)).toBeInTheDocument();
  });

  it('opens "新建节点" modal from the toolbar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleGraph), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/graphs/:id" element={<GraphEditorPage />} />
      </Routes>,
      { route: '/graphs/graph_one' },
    );
    await screen.findByText('生理学');
    await userEvent.click(screen.getByRole('button', { name: '+ 新建节点' }));
    await waitFor(() => {
      expect(screen.getByTestId('create-node-modal')).toBeInTheDocument();
    });
  });

  it('displays error UI when graph load fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: '图谱不存在' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/graphs/:id" element={<GraphEditorPage />} />
      </Routes>,
      { route: '/graphs/graph_one' },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('图谱不存在');
  });
});
