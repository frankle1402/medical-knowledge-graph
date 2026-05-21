import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { NodeForm } from '../NodeForm';

describe('NodeForm', () => {
  it('refuses empty name and surfaces validation error', async () => {
    const onSubmit = vi.fn();
    render(<NodeForm mode="create" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits create payload with knowledge_type when type is knowledge_point', async () => {
    const onSubmit = vi.fn();
    render(<NodeForm mode="create" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('名称'), '心率');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [payload, mode] = onSubmit.mock.calls[0]!;
    expect(mode).toBe('create');
    expect(payload).toMatchObject({
      node_type: 'knowledge_point',
      name: '心率',
      source: 'manual',
    });
    expect((payload as { knowledge_type?: string }).knowledge_type).toBeDefined();
  });

  it('submits update payload in edit mode without knowledge_type field', async () => {
    const onSubmit = vi.fn();
    render(
      <NodeForm
        mode="edit"
        initial={{
          node_id: 'KP_1',
          node_type: 'knowledge_point',
          name: '原',
          tags: { _legacy: ['a', 'b'] },
        }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText('名称');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '改名');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalled();
    const [payload, mode] = onSubmit.mock.calls[0]!;
    expect(mode).toBe('edit');
    expect(payload).toMatchObject({ name: '改名', tags: { _legacy: ['a', 'b'] } });
    expect((payload as { node_type?: string }).node_type).toBeUndefined();
  });
});
