import { describe, expect, it, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { GraphListPage } from '../GraphListPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Graph } from '@mkg/shared';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const sample: Graph[] = [
  {
    graph_id: 'graph_one',
    graph_name: '生理学',
    graph_type: 'course',
    subject: '医学',
    description: '示例图谱',
    status: 'active',
    node_count: 12,
    relation_count: 8,
  } as Graph,
];

describe('GraphListPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
  });

  it('renders graphs returned by the API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sample), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithProviders(<GraphListPage />);
    expect(await screen.findByText('生理学')).toBeInTheDocument();
    expect(screen.getByText(/12 节点/)).toBeInTheDocument();
  });

  it('shows empty state when API returns []', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithProviders(<GraphListPage />);
    expect(await screen.findByText(/暂无图谱/)).toBeInTheDocument();
  });

  it('opens create modal and submits a new graph', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // initial list call
      .mockResolvedValueOnce(
        new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // create call
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...sample[0], graph_id: 'graph_new', graph_name: '新建' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    renderWithProviders(<GraphListPage />);
    await screen.findByText(/暂无图谱/);
    await userEvent.click(screen.getByRole('button', { name: '新建图谱' }));
    await userEvent.type(screen.getByLabelText('图谱名称'), '新建');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/graphs/graph_new');
    });
    // Second call should be POST
    const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(secondCallInit.method).toBe('POST');
  });
});
