import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { GraphEditorPage } from '../GraphEditorPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useGraphStore } from '../../stores';

// Cytoscape requires a real <canvas> + ResizeObserver; jsdom can't render it
// meaningfully, and the page-level tests don't care about canvas internals.
// Stub GraphCanvas so we exercise the page logic only.
vi.mock('../../components/GraphEditor/GraphCanvas', async () => {
  const React = await import('react');
  return {
    GraphCanvas: () => React.createElement('div', { 'data-testid': 'mock-canvas' }),
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
      tags: {},
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

  it('renders the synonym-merge entry button in the header', async () => {
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
    expect(screen.getByTestId('open-synonym-merge-btn')).toBeInTheDocument();
  });

  it('passes graphId to NodeSearchBox so the semantic button shows', async () => {
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
    expect(screen.getByTestId('semantic-search-btn')).toBeInTheDocument();
  });
});
