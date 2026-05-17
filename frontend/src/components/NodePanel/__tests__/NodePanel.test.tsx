import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { NodePanel } from '../NodePanel';
import type { Node as KGNode, Relation } from '@mkg/shared';

const node: KGNode = {
  node_id: 'KP_X',
  node_type: 'knowledge_point',
  name: '心率',
  status: 'approved',
  confidence: 0.9,
  source: 'manual',
  knowledge_type: '概念类',
  tags: ['cardio', 'vital'],
  description: '心脏每分钟搏动次数。',
} as unknown as KGNode;

const relation: Relation = {
  relation_id: 'rel_1',
  source_id: 'KP_A',
  target_id: 'KP_B',
  relation_type: 'PREREQUISITE_OF',
  status: 'candidate',
  source: 'ai_generated',
  confidence: 0.7,
};

describe('NodePanel', () => {
  it('shows empty state when nothing is selected', () => {
    render(
      <NodePanel
        selectedNode={null}
        selectedRelation={null}
        onEdit={() => {}}
        onDelete={() => {}}
        onDeleteRelation={() => {}}
      />,
    );
    expect(screen.getByText(/选择节点或关系/)).toBeInTheDocument();
  });

  it('renders node details and triggers edit/delete callbacks', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <NodePanel
        selectedNode={node}
        selectedRelation={null}
        onEdit={onEdit}
        onDelete={onDelete}
        onDeleteRelation={() => {}}
      />,
    );
    expect(screen.getByText('心率')).toBeInTheDocument();
    expect(screen.getByText('cardio, vital')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('renders relation details and delete relation callback', async () => {
    const onDeleteRelation = vi.fn();
    render(
      <NodePanel
        selectedNode={null}
        selectedRelation={relation}
        onEdit={() => {}}
        onDelete={() => {}}
        onDeleteRelation={onDeleteRelation}
      />,
    );
    expect(screen.getByText('rel_1')).toBeInTheDocument();
    expect(screen.getByText('前置')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '删除关系' }));
    expect(onDeleteRelation).toHaveBeenCalled();
  });
});
