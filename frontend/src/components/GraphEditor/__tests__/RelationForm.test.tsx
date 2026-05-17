import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { RelationForm } from '../RelationForm';

describe('RelationForm', () => {
  it('renders source / target names and submits with selected type', async () => {
    const onSubmit = vi.fn();
    render(
      <RelationForm
        sourceId="KP_A"
        targetId="KP_B"
        sourceName="心率"
        targetName="血压"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('心率')).toBeInTheDocument();
    expect(screen.getByText('血压')).toBeInTheDocument();
    const select = screen.getByLabelText('关系类型') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'PREREQUISITE_OF');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      source_id: 'KP_A',
      target_id: 'KP_B',
      relation_type: 'PREREQUISITE_OF',
      source: 'manual',
    });
  });

  it('cancel button calls onCancel', async () => {
    const onCancel = vi.fn();
    render(<RelationForm sourceId="A" targetId="B" onSubmit={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
