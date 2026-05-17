import { describe, expect, it } from 'vitest';
import { CustomNode } from '../CustomNode';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Node as KGNode } from '@mkg/shared';

const node: KGNode = {
  node_id: 'KP_X',
  node_type: 'knowledge_point',
  name: '心率',
  status: 'candidate',
  confidence: 0.8,
  source: 'ai_generated',
  knowledge_type: '概念类',
  tags: [],
} as unknown as KGNode;

describe('CustomNode', () => {
  it('renders node name and candidate badge with dashed border', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <CustomNode
        id={node.node_id}
        type="kg"
        data={{ node }}
        selected={false}
        zIndex={0}
        isConnectable
        xPos={0}
        yPos={0}
        dragging={false}
      />,
      { reactFlow: true },
    );
    const el = getByTestId(`custom-node-${node.node_id}`);
    expect(el).toBeInTheDocument();
    expect(getByText('心率')).toBeInTheDocument();
    expect(getByText(/待审核/)).toBeInTheDocument();
    expect((el as HTMLElement).style.border).toContain('dashed');
  });

  it('renders solid border for approved nodes', () => {
    const approved: KGNode = { ...node, status: 'approved' } as unknown as KGNode;
    const { getByTestId } = renderWithProviders(
      <CustomNode
        id={approved.node_id}
        type="kg"
        data={{ node: approved }}
        selected={false}
        zIndex={0}
        isConnectable
        xPos={0}
        yPos={0}
        dragging={false}
      />,
      { reactFlow: true },
    );
    const el = getByTestId(`custom-node-${approved.node_id}`) as HTMLElement;
    expect(el.style.border).toContain('solid');
  });
});
