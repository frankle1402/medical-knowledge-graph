import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Node as KGNode, Relation } from '@mkg/shared';
import { ReviewPanel } from '../ReviewPanel';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useGraphStore } from '../../../stores';

vi.mock('../../../api', () => ({
  aiApi: {
    approveAll: vi.fn(),
    approveSome: vi.fn(),
    rejectAll: vi.fn(),
  },
}));

import { aiApi } from '../../../api';

const JOB_ID = 'job-1';

const candidateNode: KGNode = {
  node_id: 'n1',
  node_type: 'knowledge_point',
  name: '高血压定义',
  status: 'candidate',
  confidence: 0.82,
  source: 'ai',
  tags: {},
  knowledge_type: 'concept',
  ai_job_id: JOB_ID,
  description: '动脉血压持续升高的临床综合征。',
} as unknown as KGNode;

const candidateNode2: KGNode = {
  ...candidateNode,
  node_id: 'n2',
  name: '高血压分级',
} as KGNode;

const otherJobNode: KGNode = {
  ...candidateNode,
  node_id: 'n-other',
  ai_job_id: 'job-other',
  name: '别的 Job 的候选',
} as KGNode;

const approvedNode: KGNode = {
  ...candidateNode,
  node_id: 'n-approved',
  status: 'approved',
  name: '已通过的节点',
} as KGNode;

const candidateRelation: Relation = {
  relation_id: 'r1',
  source_id: 'n1',
  target_id: 'n2',
  relation_type: 'related_to',
  status: 'candidate',
  confidence: 0.7,
  source: 'ai',
  ai_job_id: JOB_ID,
} as unknown as Relation;

function seedStore(overrides?: { nodes?: KGNode[]; relations?: Relation[] }) {
  useGraphStore.setState({
    graph: null,
    nodes: overrides?.nodes ?? [candidateNode, candidateNode2, otherJobNode, approvedNode],
    relations: overrides?.relations ?? [candidateRelation],
    selectedNodeId: null,
    selectedRelationId: null,
  });
}

describe('ReviewPanel', () => {
  beforeEach(() => {
    seedStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists only candidates belonging to the active job', () => {
    renderWithProviders(<ReviewPanel open jobId={JOB_ID} onClose={() => {}} />);
    expect(screen.getByText('高血压定义')).toBeInTheDocument();
    expect(screen.getByText('高血压分级')).toBeInTheDocument();
    expect(screen.queryByText('别的 Job 的候选')).not.toBeInTheDocument();
    expect(screen.queryByText('已通过的节点')).not.toBeInTheDocument();
    // Relation row uses "source → target" format.
    expect(screen.getByText('高血压定义 → 高血压分级')).toBeInTheDocument();
  });

  it('renders an empty message when there are no candidates', () => {
    seedStore({ nodes: [approvedNode], relations: [] });
    renderWithProviders(<ReviewPanel open jobId={JOB_ID} onClose={() => {}} />);
    expect(
      screen.getByText('该 Job 当前没有待审核的候选节点或关系。'),
    ).toBeInTheDocument();
  });

  it('approve-all calls the api and flips statuses to approved', async () => {
    vi.mocked(aiApi.approveAll).mockResolvedValue({ ok: true, nodes: 2, relations: 1 });
    const onClose = vi.fn();
    renderWithProviders(<ReviewPanel open jobId={JOB_ID} onClose={onClose} />);

    await userEvent.click(screen.getByTestId('review-approve-all'));

    await waitFor(() => {
      expect(aiApi.approveAll).toHaveBeenCalledWith(JOB_ID);
    });
    await waitFor(() => {
      const state = useGraphStore.getState();
      expect(state.nodes.find((n) => n.node_id === 'n1')?.status).toBe('approved');
      expect(state.nodes.find((n) => n.node_id === 'n2')?.status).toBe('approved');
      expect(state.relations.find((r) => r.relation_id === 'r1')?.status).toBe('approved');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('approve-selected sends only the chosen ids', async () => {
    vi.mocked(aiApi.approveSome).mockResolvedValue({ ok: true, nodes: 1, relations: 0 });
    renderWithProviders(<ReviewPanel open jobId={JOB_ID} onClose={() => {}} />);

    // The "通过所选" button starts disabled because nothing is selected.
    const approveSelectedBtn = screen.getByTestId('review-approve-selected');
    expect(approveSelectedBtn).toBeDisabled();

    await userEvent.click(screen.getByLabelText('选择:高血压定义'));
    expect(approveSelectedBtn).not.toBeDisabled();
    await userEvent.click(approveSelectedBtn);

    await waitFor(() => {
      expect(aiApi.approveSome).toHaveBeenCalledWith(JOB_ID, {
        node_ids: ['n1'],
        relation_ids: [],
      });
    });
    await waitFor(() => {
      const state = useGraphStore.getState();
      expect(state.nodes.find((n) => n.node_id === 'n1')?.status).toBe('approved');
      // n2 is still candidate.
      expect(state.nodes.find((n) => n.node_id === 'n2')?.status).toBe('candidate');
    });
  });

  it('reject-all removes candidates from the store after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(aiApi.rejectAll).mockResolvedValue({ ok: true, nodes: 0, relations: 0 });
    const onClose = vi.fn();
    renderWithProviders(<ReviewPanel open jobId={JOB_ID} onClose={onClose} />);

    await userEvent.click(screen.getByTestId('review-reject-all'));

    await waitFor(() => {
      expect(aiApi.rejectAll).toHaveBeenCalledWith(JOB_ID);
    });
    await waitFor(() => {
      const state = useGraphStore.getState();
      // Candidates for this job removed; other-job candidate + approved kept.
      expect(state.nodes.map((n) => n.node_id).sort()).toEqual(['n-approved', 'n-other']);
      expect(state.relations).toEqual([]);
    });
    expect(onClose).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
