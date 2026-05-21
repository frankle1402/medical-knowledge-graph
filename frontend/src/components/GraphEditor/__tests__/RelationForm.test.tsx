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

  it('edit mode pre-fills relation_type / description / confidence / status', () => {
    render(
      <RelationForm
        mode="edit"
        sourceId="A"
        targetId="B"
        sourceName="心率"
        targetName="血压"
        initial={{
          relation_type: 'PREREQUISITE_OF',
          description: 'because',
          confidence: 0.42,
          status: 'approved',
        }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByLabelText('关系类型') as HTMLSelectElement).value).toBe('PREREQUISITE_OF');
    expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe('because');
    expect((screen.getByLabelText('置信度') as HTMLInputElement).value).toBe('0.42');
    expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('approved');
  });

  it('edit mode submits a patch payload without source_id / target_id', async () => {
    const onSubmit = vi.fn();
    render(
      <RelationForm
        mode="edit"
        sourceId="A"
        targetId="B"
        initial={{
          relation_type: 'RELATED_TO',
          description: '',
          confidence: 1,
          status: 'candidate',
        }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('关系类型'), 'EASILY_CONFUSED_WITH');
    await userEvent.clear(screen.getByLabelText('置信度'));
    await userEvent.type(screen.getByLabelText('置信度'), '0.8');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload).toMatchObject({
      relation_type: 'EASILY_CONFUSED_WITH',
      confidence: 0.8,
      status: 'candidate',
    });
    expect(payload).not.toHaveProperty('source_id');
    expect(payload).not.toHaveProperty('target_id');
    expect(payload).not.toHaveProperty('source');
  });

  it('create mode (default) still submits create payload (regression)', async () => {
    const onSubmit = vi.fn();
    render(
      <RelationForm sourceId="A" targetId="B" onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      source_id: 'A',
      target_id: 'B',
      source: 'manual',
    });
  });
});
