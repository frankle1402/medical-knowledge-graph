import { describe, expect, it, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import type { Node as KGNode } from '@mkg/shared';
import { NodeSearchBox } from '../NodeSearchBox';
import { searchApi } from '../../../api';

const makeNode = (id: string, name: string): KGNode =>
  ({
    node_id: id,
    name,
    node_type: 'knowledge_point',
    status: 'approved',
    source: 'manual',
    confidence: 1,
  }) as unknown as KGNode;

const sampleNodes: KGNode[] = [
  makeNode('n1', '心率'),
  makeNode('n2', '心率失常'),
  makeNode('n3', '心力衰竭'),
  makeNode('n4', '血压'),
];

describe('NodeSearchBox', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing in the dropdown until user types', () => {
    render(<NodeSearchBox nodes={sampleNodes} onSelect={() => {}} />);
    expect(screen.queryByTestId('node-search-results')).toBeNull();
  });

  it('shows fuzzy substring matches and selecting one fires onSelect', async () => {
    const onSelect = vi.fn();
    render(<NodeSearchBox nodes={sampleNodes} onSelect={onSelect} />);

    const input = screen.getByTestId('node-search-input');
    await userEvent.type(input, '心率');

    const list = screen.getByTestId('node-search-results');
    expect(list).toBeTruthy();
    // both "心率" and "心率失常" should match; "血压" should not.
    expect(screen.getByTestId('node-search-result-n1')).toBeTruthy();
    expect(screen.getByTestId('node-search-result-n2')).toBeTruthy();
    expect(screen.queryByTestId('node-search-result-n4')).toBeNull();

    await userEvent.click(screen.getByTestId('node-search-result-n1'));
    expect(onSelect).toHaveBeenCalledWith('n1');
  });

  it('caps suggestions at 8', async () => {
    const many: KGNode[] = Array.from({ length: 20 }, (_, i) =>
      makeNode(`x${i}`, `节点-${i}`),
    );
    render(<NodeSearchBox nodes={many} onSelect={() => {}} />);
    await userEvent.type(screen.getByTestId('node-search-input'), '节点');
    const items = screen.getAllByTestId(/^node-search-result-/);
    expect(items.length).toBe(8);
  });

  it('clears the input after a selection', async () => {
    render(<NodeSearchBox nodes={sampleNodes} onSelect={() => {}} />);
    const input = screen.getByTestId('node-search-input') as HTMLInputElement;
    await userEvent.type(input, '心率');
    await userEvent.click(screen.getByTestId('node-search-result-n1'));
    expect(input.value).toBe('');
  });

  describe('semantic mode (when graphId is provided)', () => {
    it('does not render the semantic button when graphId is omitted', () => {
      render(<NodeSearchBox nodes={sampleNodes} onSelect={() => {}} />);
      expect(screen.queryByTestId('semantic-search-btn')).toBeNull();
    });

    it('renders the semantic button (disabled until input has text)', () => {
      render(<NodeSearchBox nodes={sampleNodes} onSelect={() => {}} graphId="g1" />);
      const btn = screen.getByTestId('semantic-search-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.disabled).toBe(true);
    });

    it('calls searchApi.semantic and renders semantic results with scores', async () => {
      const semanticSpy = vi.spyOn(searchApi, 'semantic').mockResolvedValue({
        matches: [
          {
            node: { node_id: 'n3', name: '心力衰竭', node_type: 'knowledge_point' },
            score: 0.92,
          },
          {
            node: { node_id: 'n2', name: '心率失常', node_type: 'knowledge_point' },
            score: 0.81,
          },
        ],
      });

      render(<NodeSearchBox nodes={sampleNodes} onSelect={() => {}} graphId="g1" />);
      await userEvent.type(screen.getByTestId('node-search-input'), '心跳节奏不齐');
      await userEvent.click(screen.getByTestId('semantic-search-btn'));

      await waitFor(() => {
        expect(semanticSpy).toHaveBeenCalledTimes(1);
      });
      expect(semanticSpy.mock.calls[0]?.[0]).toBe('g1');
      expect(semanticSpy.mock.calls[0]?.[1]).toBe('心跳节奏不齐');

      const list = await screen.findByTestId('node-search-results');
      expect(list.getAttribute('data-mode')).toBe('semantic');
      expect(screen.getByTestId('semantic-badge')).toBeTruthy();
      expect(screen.getByTestId('node-search-result-n3')).toBeTruthy();
      expect(screen.getByTestId('semantic-score-n3').textContent).toBe('0.92');
      expect(screen.getByTestId('semantic-score-n2').textContent).toBe('0.81');
    });

    it('selecting a semantic result fires onSelect with the right id', async () => {
      vi.spyOn(searchApi, 'semantic').mockResolvedValue({
        matches: [
          {
            node: { node_id: 'n3', name: '心力衰竭', node_type: 'knowledge_point' },
            score: 0.92,
          },
        ],
      });
      const onSelect = vi.fn();
      render(<NodeSearchBox nodes={sampleNodes} onSelect={onSelect} graphId="g1" />);
      await userEvent.type(screen.getByTestId('node-search-input'), 'q');
      await userEvent.click(screen.getByTestId('semantic-search-btn'));
      await screen.findByTestId('semantic-badge');
      await userEvent.click(screen.getByTestId('node-search-result-n3'));
      expect(onSelect).toHaveBeenCalledWith('n3');
    });

    it('falls back to substring mode after typing again', async () => {
      vi.spyOn(searchApi, 'semantic').mockResolvedValue({
        matches: [
          {
            node: { node_id: 'n3', name: '心力衰竭', node_type: 'knowledge_point' },
            score: 0.92,
          },
        ],
      });
      render(<NodeSearchBox nodes={sampleNodes} onSelect={() => {}} graphId="g1" />);
      const input = screen.getByTestId('node-search-input') as HTMLInputElement;
      await userEvent.type(input, '心率');
      await userEvent.click(screen.getByTestId('semantic-search-btn'));
      await screen.findByTestId('semantic-badge');

      // User types another character → returns to lexical results.
      // Click the input first to trigger React's onFocus (the previous
      // button click blurred it).
      await userEvent.click(input);
      await userEvent.type(input, '失常');
      await waitFor(() => {
        const list = screen.getByTestId('node-search-results');
        expect(list.getAttribute('data-mode')).toBe('lexical');
      });
      expect(screen.queryByTestId('semantic-badge')).toBeNull();
    });
  });
});
