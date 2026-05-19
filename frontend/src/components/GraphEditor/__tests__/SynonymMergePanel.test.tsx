import { describe, expect, it, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Relation } from '@mkg/shared';
import { SynonymMergePanel, runMerge } from '../SynonymMergePanel';
import { learningApi, nodesApi, relationsApi } from '../../../api';
import { ApiError } from '../../../lib/api';

const mkRel = (
  source_id: string,
  target_id: string,
  relation_type: string,
  relation_id = `${source_id}-${target_id}-${relation_type}`,
): Relation =>
  ({
    relation_id,
    source_id,
    target_id,
    relation_type,
    status: 'approved',
    source: 'manual',
    confidence: 1,
  }) as unknown as Relation;

describe('SynonymMergePanel — UI flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when not open', () => {
    render(
      <SynonymMergePanel
        open={false}
        graphId="g1"
        relations={[]}
        onClose={() => {}}
        onMerged={() => {}}
      />,
    );
    expect(screen.queryByTestId('synonym-merge-panel')).toBeNull();
  });

  it('loads candidates with default threshold and shows list', async () => {
    const spy = vi.spyOn(learningApi, 'synonymCandidates').mockResolvedValue({
      candidates: [
        { a: { node_id: 'n1', name: '心律失常' }, b: { node_id: 'n2', name: '心率失常' }, score: 0.97 },
      ],
    });
    render(
      <SynonymMergePanel
        open
        graphId="g1"
        relations={[]}
        onClose={() => {}}
        onMerged={() => {}}
      />,
    );
    await screen.findByTestId('synonym-candidate-n1-n2');
    expect(spy).toHaveBeenCalledWith('g1', 0.92);
  });

  it('shows embeddings_not_ready hint on 503', async () => {
    vi.spyOn(learningApi, 'synonymCandidates').mockRejectedValue(
      new ApiError('embeddings_not_ready', 503, 'embeddings_not_ready'),
    );
    render(
      <SynonymMergePanel
        open
        graphId="g1"
        relations={[]}
        onClose={() => {}}
        onMerged={() => {}}
      />,
    );
    expect(
      await screen.findByTestId('synonym-embeddings-not-ready'),
    ).toBeInTheDocument();
  });

  it('shows empty-state copy when there are no candidates', async () => {
    vi.spyOn(learningApi, 'synonymCandidates').mockResolvedValue({ candidates: [] });
    render(
      <SynonymMergePanel
        open
        graphId="g1"
        relations={[]}
        onClose={() => {}}
        onMerged={() => {}}
      />,
    );
    expect(await screen.findByTestId('synonym-empty')).toBeInTheDocument();
  });

  it('reloads when threshold changes', async () => {
    const spy = vi
      .spyOn(learningApi, 'synonymCandidates')
      .mockResolvedValue({ candidates: [] });
    render(
      <SynonymMergePanel
        open
        graphId="g1"
        relations={[]}
        onClose={() => {}}
        onMerged={() => {}}
      />,
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const slider = screen.getByTestId('synonym-threshold');
    fireEvent.change(slider, { target: { value: '0.95' } });

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const last = spy.mock.calls.at(-1)!;
    expect(last[1]).toBeCloseTo(0.95, 2);
  });

  it('opens confirm modal then runs the merge on confirm', async () => {
    vi.spyOn(learningApi, 'synonymCandidates').mockResolvedValue({
      candidates: [
        { a: { node_id: 'n1', name: '心律失常' }, b: { node_id: 'n2', name: '心率失常' }, score: 0.97 },
      ],
    });
    const removeSpy = vi
      .spyOn(nodesApi, 'remove')
      .mockResolvedValue({ ok: true });
    const onMerged = vi.fn();

    render(
      <SynonymMergePanel
        open
        graphId="g1"
        relations={[]}
        onClose={() => {}}
        onMerged={onMerged}
      />,
    );

    await screen.findByTestId('synonym-candidate-n1-n2');
    await userEvent.click(screen.getByTestId('synonym-keep-a-n1-n2'));

    const confirmModal = await screen.findByTestId('synonym-confirm-modal');
    expect(within(confirmModal).getByTestId('synonym-confirm-ok')).toBeTruthy();

    await userEvent.click(screen.getByTestId('synonym-confirm-ok'));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('n2'));
    expect(onMerged).toHaveBeenCalled();
  });
});

describe('runMerge — rewire bookkeeping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const candidate = {
    a: { node_id: 'A', name: 'A' },
    b: { node_id: 'B', name: 'B' },
    score: 0.95,
  };
  const pending = {
    candidate,
    keepId: 'A',
    discardId: 'B',
    keepName: 'A',
    discardName: 'B',
  };

  it('rewires distinct relations onto keep and deletes discard', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    const removeSpy = vi
      .spyOn(nodesApi, 'remove')
      .mockResolvedValue({ ok: true });

    const relations: Relation[] = [
      mkRel('B', 'C', 'PREREQUISITE_OF'),
      mkRel('D', 'B', 'RELATED_TO'),
    ];

    const result = await runMerge('g1', pending, relations);

    expect(result).toEqual({ rewired: 2, skipped: 0, errors: [] });
    expect(createSpy).toHaveBeenCalledTimes(2);
    // First call: B→C becomes A→C
    expect(createSpy.mock.calls[0]?.[1]).toMatchObject({
      source_id: 'A',
      target_id: 'C',
      relation_type: 'PREREQUISITE_OF',
    });
    // Second call: D→B becomes D→A
    expect(createSpy.mock.calls[1]?.[1]).toMatchObject({
      source_id: 'D',
      target_id: 'A',
      relation_type: 'RELATED_TO',
    });
    expect(removeSpy).toHaveBeenCalledWith('B');
  });

  it('skips self-loop relations between keep and discard', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    const relations: Relation[] = [mkRel('A', 'B', 'RELATED_TO')];
    const result = await runMerge('g1', pending, relations);

    expect(result).toEqual({ rewired: 0, skipped: 1, errors: [] });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('skips duplicates when keep already has the same (target, type)', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    const relations: Relation[] = [
      // Keep already has A → C of the same type.
      mkRel('A', 'C', 'PREREQUISITE_OF', 'r-keep'),
      // Discard would rewire to a duplicate.
      mkRel('B', 'C', 'PREREQUISITE_OF', 'r-discard'),
    ];

    const result = await runMerge('g1', pending, relations);
    expect(result).toEqual({ rewired: 0, skipped: 1, errors: [] });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('records errors on relation create failure but still removes discard', async () => {
    vi.spyOn(relationsApi, 'create').mockRejectedValue(new Error('boom'));
    const removeSpy = vi
      .spyOn(nodesApi, 'remove')
      .mockResolvedValue({ ok: true });

    const relations: Relation[] = [mkRel('B', 'C', 'PREREQUISITE_OF')];
    const result = await runMerge('g1', pending, relations);

    expect(result.rewired).toBe(0);
    expect(result.errors).toContain('boom');
    expect(removeSpy).toHaveBeenCalledWith('B');
  });

  it('reports failure when discard delete fails', async () => {
    vi.spyOn(relationsApi, 'create').mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockRejectedValue(new Error('cant_delete'));

    const result = await runMerge('g1', pending, []);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('cant_delete');
  });
});
