import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { Node as KGNode } from '@mkg/shared';
import { NodeSearchBox } from '../NodeSearchBox';

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
});
