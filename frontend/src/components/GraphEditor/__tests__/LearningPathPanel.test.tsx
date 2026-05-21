import { describe, expect, it, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { LearningPathPanel } from '../LearningPathPanel';
import { learningApi } from '../../../api';
import { ApiError } from '../../../lib/api';

const samplePath = {
  target: { node_id: 'KP_target', name: '心力衰竭治疗' },
  path: [
    { node_id: 'KP_a', name: '心脏解剖', depth: 3, via: 'PREREQUISITE_OF' },
    { node_id: 'KP_b', name: '心电图', depth: 2, via: 'PREREQUISITE_OF' },
    { node_id: 'KP_c', name: '心律失常', depth: 1, via: 'PREREQUISITE_OF' },
  ],
};

describe('LearningPathPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when nodeId is null', () => {
    const { container } = render(
      <LearningPathPanel nodeId={null} onClose={() => {}} onJumpToNode={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows skeleton, then renders 3 prereq steps + target row', async () => {
    vi.spyOn(learningApi, 'learningPath').mockResolvedValue(samplePath);
    render(
      <LearningPathPanel
        nodeId="KP_target"
        onClose={() => {}}
        onJumpToNode={() => {}}
      />,
    );
    expect(screen.getByTestId('learning-path-skeleton')).toBeInTheDocument();
    await screen.findByTestId('learning-path-list');
    expect(screen.getByTestId('learning-path-step-KP_a')).toBeTruthy();
    expect(screen.getByTestId('learning-path-step-KP_b')).toBeTruthy();
    expect(screen.getByTestId('learning-path-step-KP_c')).toBeTruthy();
    expect(screen.getByTestId('learning-path-target')).toHaveTextContent('心力衰竭治疗');
  });

  it('clicking a step calls onJumpToNode with the right id', async () => {
    vi.spyOn(learningApi, 'learningPath').mockResolvedValue(samplePath);
    const onJump = vi.fn();
    render(
      <LearningPathPanel nodeId="KP_target" onClose={() => {}} onJumpToNode={onJump} />,
    );
    await screen.findByTestId('learning-path-list');
    await userEvent.click(screen.getByTestId('learning-path-step-KP_b'));
    expect(onJump).toHaveBeenCalledWith('KP_b');
  });

  it('close button fires onClose', async () => {
    vi.spyOn(learningApi, 'learningPath').mockResolvedValue(samplePath);
    const onClose = vi.fn();
    render(
      <LearningPathPanel nodeId="KP_target" onClose={onClose} onJumpToNode={() => {}} />,
    );
    await screen.findByTestId('learning-path-list');
    await userEvent.click(screen.getByTestId('learning-path-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders empty-state copy when no prereqs', async () => {
    vi.spyOn(learningApi, 'learningPath').mockResolvedValue({
      target: { node_id: 'x', name: '入门概念' },
      path: [],
    });
    render(
      <LearningPathPanel nodeId="x" onClose={() => {}} onJumpToNode={() => {}} />,
    );
    expect(await screen.findByTestId('learning-path-empty')).toBeInTheDocument();
  });

  it('shows not-found state on 404', async () => {
    vi.spyOn(learningApi, 'learningPath').mockRejectedValue(
      new ApiError('node_not_found', 404, 'node_not_found'),
    );
    render(
      <LearningPathPanel nodeId="missing" onClose={() => {}} onJumpToNode={() => {}} />,
    );
    expect(await screen.findByTestId('learning-path-not-found')).toBeInTheDocument();
  });

  it('shows error UI on generic failure and retry refetches', async () => {
    const spy = vi
      .spyOn(learningApi, 'learningPath')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(samplePath);
    render(
      <LearningPathPanel nodeId="KP_target" onClose={() => {}} onJumpToNode={() => {}} />,
    );
    expect(await screen.findByTestId('learning-path-error')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('learning-path-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('learning-path-list')).toBeInTheDocument();
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reloads when nodeId changes', async () => {
    const spy = vi
      .spyOn(learningApi, 'learningPath')
      .mockResolvedValueOnce({
        target: { node_id: 'A', name: 'A' },
        path: [{ node_id: 'P1', name: 'P1', depth: 1, via: 'PREREQUISITE_OF' }],
      })
      .mockResolvedValueOnce({
        target: { node_id: 'B', name: 'B' },
        path: [{ node_id: 'P2', name: 'P2', depth: 1, via: 'PREREQUISITE_OF' }],
      });

    const { rerender } = render(
      <LearningPathPanel nodeId="A" onClose={() => {}} onJumpToNode={() => {}} />,
    );
    await screen.findByTestId('learning-path-step-P1');
    rerender(
      <LearningPathPanel nodeId="B" onClose={() => {}} onJumpToNode={() => {}} />,
    );
    await screen.findByTestId('learning-path-step-P2');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toBe('A');
    expect(spy.mock.calls[1]?.[0]).toBe('B');
  });

  it('calls onPathLoaded with [target, ...path] node ids once data resolves', async () => {
    vi.spyOn(learningApi, 'learningPath').mockResolvedValue(samplePath);
    const onPathLoaded = vi.fn();
    render(
      <LearningPathPanel
        nodeId="KP_target"
        onClose={() => {}}
        onJumpToNode={() => {}}
        onPathLoaded={onPathLoaded}
      />,
    );
    await screen.findByTestId('learning-path-list');
    expect(onPathLoaded).toHaveBeenCalledTimes(1);
    expect(onPathLoaded).toHaveBeenCalledWith(['KP_target', 'KP_a', 'KP_b', 'KP_c']);
  });

  it('does not call onPathLoaded on 404', async () => {
    vi.spyOn(learningApi, 'learningPath').mockRejectedValue(
      new ApiError('node_not_found', 404, 'node_not_found'),
    );
    const onPathLoaded = vi.fn();
    render(
      <LearningPathPanel
        nodeId="missing"
        onClose={() => {}}
        onJumpToNode={() => {}}
        onPathLoaded={onPathLoaded}
      />,
    );
    await screen.findByTestId('learning-path-not-found');
    expect(onPathLoaded).not.toHaveBeenCalled();
  });

  it('still calls onPathLoaded with [target] when path is empty', async () => {
    vi.spyOn(learningApi, 'learningPath').mockResolvedValue({
      target: { node_id: 'leaf', name: '入门' },
      path: [],
    });
    const onPathLoaded = vi.fn();
    render(
      <LearningPathPanel
        nodeId="leaf"
        onClose={() => {}}
        onJumpToNode={() => {}}
        onPathLoaded={onPathLoaded}
      />,
    );
    await screen.findByTestId('learning-path-empty');
    expect(onPathLoaded).toHaveBeenCalledWith(['leaf']);
  });
});
