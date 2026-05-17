import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { TemplateVariable } from '@mkg/shared';
import { TemplateVariableEditor, type VariableValue } from '../TemplateVariableEditor';

const VARS: TemplateVariable[] = [
  { key: 'topic', label: '主题', type: 'text', required: true },
  { key: 'note', label: '说明', type: 'textarea', required: false },
  {
    key: 'difficulty',
    label: '难度',
    type: 'select',
    options: ['简单', '中等', '困难'],
    required: false,
  },
  { key: 'count', label: '数量', type: 'number', required: false },
  { key: 'enabled', label: '启用', type: 'boolean', required: false },
];

function Harness({ onChangeSpy }: { onChangeSpy?: (k: string, v: VariableValue) => void }) {
  const [values, setValues] = useState<Record<string, VariableValue>>({});
  return (
    <TemplateVariableEditor
      variables={VARS}
      values={values}
      onChange={(k, v) => {
        onChangeSpy?.(k, v);
        setValues((prev) => ({ ...prev, [k]: v }));
      }}
    />
  );
}

describe('TemplateVariableEditor', () => {
  it('renders the empty state when no variables are defined', () => {
    render(
      <TemplateVariableEditor variables={[]} values={{}} onChange={() => {}} />,
    );
    expect(screen.getByText('该模板未声明变量。')).toBeInTheDocument();
  });

  it('renders one control per variable type', () => {
    render(<Harness />);
    const topic = screen.getByLabelText('主题') as HTMLInputElement;
    expect(topic.tagName).toBe('INPUT');
    expect(topic.type).toBe('text');

    const note = screen.getByLabelText('说明') as HTMLTextAreaElement;
    expect(note.tagName).toBe('TEXTAREA');

    const difficulty = screen.getByLabelText('难度') as HTMLSelectElement;
    expect(difficulty.tagName).toBe('SELECT');
    // 1 placeholder option + 3 real options
    expect(difficulty.querySelectorAll('option').length).toBe(4);

    const count = screen.getByLabelText('数量') as HTMLInputElement;
    expect(count.type).toBe('number');

    const enabled = screen.getByLabelText('启用') as HTMLInputElement;
    expect(enabled.type).toBe('checkbox');
  });

  it('emits onChange with proper types for each control', async () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);

    await userEvent.type(screen.getByLabelText('主题'), 'AI');
    expect(spy).toHaveBeenCalledWith('topic', 'A');
    expect(spy).toHaveBeenCalledWith('topic', 'AI');

    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '7' } });
    expect(spy).toHaveBeenCalledWith('count', 7);

    fireEvent.click(screen.getByLabelText('启用'));
    expect(spy).toHaveBeenCalledWith('enabled', true);

    fireEvent.change(screen.getByLabelText('难度'), { target: { value: '中等' } });
    expect(spy).toHaveBeenCalledWith('difficulty', '中等');
  });

  it('shows error text under a field when errors prop has entries', () => {
    render(
      <TemplateVariableEditor
        variables={VARS}
        values={{}}
        onChange={() => {}}
        errors={{ topic: '请填写主题' }}
      />,
    );
    expect(screen.getByText('请填写主题')).toBeInTheDocument();
  });

  it('marks required fields with an asterisk', () => {
    render(<TemplateVariableEditor variables={VARS} values={{}} onChange={() => {}} />);
    // The required marker lives in the same span as the label text.
    const labelSpan = screen.getByText('主题');
    expect(labelSpan.textContent).toContain('*');
  });
});
