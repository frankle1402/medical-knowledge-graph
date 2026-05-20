import { describe, expect, it, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Relation } from '@mkg/shared';
import { SynonymMergePanel, runMerge } from '../SynonymMergePanel';
import { learningApi, nodesApi, relationsApi } from '../../../api';
import { ApiError } from '../../../lib/api';

const mkRel = (
  source_id: string,
  target_id: string,
  relation_type: string,
  overrides: Partial<Relation> = {},
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
    ...overrides,
  }) as unknown as Relation;

describe('SynonymMergePanel — UI flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('debounces rapid threshold changes to a single API call (I3)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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

    // Initial debounced load: advance past the 300ms window so the first
    // request fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(spy).toHaveBeenCalledTimes(1);

    const slider = screen.getByTestId('synonym-threshold');
    // Simulate 5 rapid drag ticks within 250ms (less than debounce window).
    for (const v of ['0.93', '0.94', '0.95', '0.96', '0.97']) {
      fireEvent.change(slider, { target: { value: v } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    // Still only the initial call — debounce hasn't fired yet for the drag.
    expect(spy).toHaveBeenCalledTimes(1);

    // Let the debounce expire on the last value.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(spy).toHaveBeenCalledTimes(2);
    const lastCall = spy.mock.calls.at(-1)!;
    expect(lastCall[1]).toBeCloseTo(0.97, 2);
  });

  it('opens confirm modal then runs the merge on confirm', async () => {
    vi.spyOn(learningApi, 'synonymCandidates').mockResolvedValue({
      candidates: [
        { a: { node_id: 'n1', name: '心律失常' }, b: { node_id: 'n2', name: '心率失常' }, score: 0.97 },
      ],
    });
    vi.spyOn(relationsApi, 'list').mockResolvedValue([]);
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

  it('confirm dialog shows count of incident relations to be moved (UX)', async () => {
    vi.spyOn(learningApi, 'synonymCandidates').mockResolvedValue({
      candidates: [
        { a: { node_id: 'n1', name: 'A' }, b: { node_id: 'n2', name: 'B' }, score: 0.97 },
      ],
    });

    const relations: Relation[] = [
      mkRel('n2', 'C', 'PREREQUISITE_OF', {}, 'r1'),
      mkRel('n2', 'D', 'RELATED_TO', {}, 'r2'),
      mkRel('E', 'n2', 'PART_OF', {}, 'r3'),
      // unrelated edge — not incident to n2
      mkRel('X', 'Y', 'PREREQUISITE_OF', {}, 'r4'),
    ];

    render(
      <SynonymMergePanel
        open
        graphId="g1"
        relations={relations}
        onClose={() => {}}
        onMerged={() => {}}
      />,
    );

    await screen.findByTestId('synonym-candidate-n1-n2');
    await userEvent.click(screen.getByTestId('synonym-keep-a-n1-n2'));

    const countNode = await screen.findByTestId('synonym-confirm-count');
    expect(countNode.textContent).toContain('3');
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
    vi.spyOn(relationsApi, 'list').mockResolvedValue(relations);

    const result = await runMerge('g1', pending, []);

    expect(result.rewired).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.replaced).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.deletedDiscard).toBe(true);
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

  it('skips when keep already has same edge at higher confidence (I1)', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    const removeRelSpy = vi
      .spyOn(relationsApi, 'remove')
      .mockResolvedValue({ ok: true });
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      mkRel('A', 'C', 'PREREQUISITE_OF', { confidence: 0.9 }, 'r-keep'),
      mkRel('B', 'C', 'PREREQUISITE_OF', { confidence: 0.7 }, 'r-discard'),
    ]);

    const result = await runMerge('g1', pending, []);

    expect(result.rewired).toBe(0);
    expect(result.replaced).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
    expect(removeRelSpy).not.toHaveBeenCalled();
  });

  it('replaces keep edge when discard has higher confidence (I1)', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    const removeRelSpy = vi
      .spyOn(relationsApi, 'remove')
      .mockResolvedValue({ ok: true });
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      mkRel('A', 'C', 'PREREQUISITE_OF', { confidence: 0.7 }, 'r-keep-low'),
      mkRel('B', 'C', 'PREREQUISITE_OF', { confidence: 0.9 }, 'r-discard-high'),
    ]);

    const result = await runMerge('g1', pending, []);

    expect(result.replaced).toBe(1);
    expect(result.rewired).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(removeRelSpy).toHaveBeenCalledWith('r-keep-low');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[1]).toMatchObject({
      source_id: 'A',
      target_id: 'C',
      confidence: 0.9,
    });
  });

  it('creates new edge when no collision (I1 — confidence dedup, no collision case)', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    const removeRelSpy = vi
      .spyOn(relationsApi, 'remove')
      .mockResolvedValue({ ok: true });
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      // keep has A→C with PREREQUISITE_OF
      mkRel('A', 'C', 'PREREQUISITE_OF', { confidence: 0.95 }, 'r-keep'),
      // discard has B→D with PREREQUISITE_OF — different other-end, no collision
      mkRel('B', 'D', 'PREREQUISITE_OF', { confidence: 0.5 }, 'r-discard'),
    ]);

    const result = await runMerge('g1', pending, []);

    expect(result.rewired).toBe(1);
    expect(result.replaced).toBe(0);
    expect(result.skipped).toBe(0);
    expect(removeRelSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('skips self-loop (relation between keep and discard)', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      // A↔B — would self-loop after rewire
      mkRel('B', 'A', 'PREREQUISITE_OF'),
    ]);

    const result = await runMerge('g1', pending, []);
    expect(result.skipped).toBe(1);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('preserves status and source on rewired relations (I2)', async () => {
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      mkRel(
        'B',
        'C',
        'PREREQUISITE_OF',
        { status: 'candidate', source: 'ai_generated', confidence: 0.85 },
        'r1',
      ),
    ]);

    await runMerge('g1', pending, []);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[1]).toMatchObject({
      source_id: 'A',
      target_id: 'C',
      relation_type: 'PREREQUISITE_OF',
      confidence: 0.85,
      status: 'candidate',
      source: 'ai_generated',
    });
  });

  it('does NOT delete discard node when any rewire failed (B1)', async () => {
    vi.spyOn(relationsApi, 'create').mockRejectedValue(new Error('boom'));
    const removeNodeSpy = vi
      .spyOn(nodesApi, 'remove')
      .mockResolvedValue({ ok: true });
    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      mkRel('B', 'C', 'PREREQUISITE_OF'),
    ]);

    const result = await runMerge('g1', pending, []);

    expect(result.rewired).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('boom');
    expect(result.deletedDiscard).toBe(false);
    expect(removeNodeSpy).not.toHaveBeenCalled();
  });

  it('deletes discard node when all rewires succeed (B1, positive case)', async () => {
    vi.spyOn(relationsApi, 'create').mockResolvedValue({} as never);
    const removeNodeSpy = vi
      .spyOn(nodesApi, 'remove')
      .mockResolvedValue({ ok: true });
    vi.spyOn(relationsApi, 'list').mockResolvedValue([
      mkRel('B', 'C', 'PREREQUISITE_OF'),
      mkRel('D', 'B', 'RELATED_TO'),
    ]);

    const result = await runMerge('g1', pending, []);
    expect(result.errors).toEqual([]);
    expect(result.deletedDiscard).toBe(true);
    expect(removeNodeSpy).toHaveBeenCalledWith('B');
  });

  it('reports failure when discard delete fails (deletedDiscard=false)', async () => {
    vi.spyOn(relationsApi, 'create').mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockRejectedValue(new Error('cant_delete'));
    vi.spyOn(relationsApi, 'list').mockResolvedValue([]);

    const result = await runMerge('g1', pending, []);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('cant_delete');
    expect(result.deletedDiscard).toBe(false);
  });

  it('refetches keep node relations to avoid stale snapshot (I4)', async () => {
    const listSpy = vi.spyOn(relationsApi, 'list').mockResolvedValue([
      // Fresh data: a NEW manual relation A→C was created after the panel
      // rendered. The stale prop snapshot below does NOT contain it. The
      // fresh fetch must be used so the discard's B→C is correctly skipped.
      mkRel('A', 'C', 'PREREQUISITE_OF', { confidence: 0.99 }, 'r-fresh-keep'),
      mkRel('B', 'C', 'PREREQUISITE_OF', { confidence: 0.5 }, 'r-discard'),
    ]);
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    const stale: Relation[] = [
      mkRel('B', 'C', 'PREREQUISITE_OF', { confidence: 0.5 }, 'r-discard'),
    ];

    const result = await runMerge('g1', pending, stale);

    expect(listSpy).toHaveBeenCalledWith('g1');
    expect(result.skipped).toBe(1);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('falls back to prop relations when fresh fetch fails (I4 robustness)', async () => {
    vi.spyOn(relationsApi, 'list').mockRejectedValue(new Error('net'));
    const createSpy = vi
      .spyOn(relationsApi, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(nodesApi, 'remove').mockResolvedValue({ ok: true });

    const fallback: Relation[] = [mkRel('B', 'C', 'PREREQUISITE_OF')];
    const result = await runMerge('g1', pending, fallback);
    expect(result.rewired).toBe(1);
    expect(result.deletedDiscard).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
