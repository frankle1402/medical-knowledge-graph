import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromptTemplate } from '@mkg/shared';
import { TemplatesPage } from '../TemplatesPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useAuthStore } from '../../stores';

// Stub Monaco — jsdom can't load the real editor. The wrapper exposes a
// textarea-equivalent so tests can drive value/onChange like a normal field.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    'aria-label': ariaLabel,
  }: {
    value: string;
    onChange: (next: string | undefined) => void;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api', () => ({
  templatesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  authApi: {
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

import { templatesApi } from '../../api';

const TPL: PromptTemplate = {
  id: '00000000-0000-0000-0000-0000000000ee',
  name: '章节抽取',
  description: '从文本中抽取章节结构',
  variables: [
    { key: 'topic', label: '主题', type: 'text', required: true },
    {
      key: 'level',
      label: '难度',
      type: 'select',
      options: ['基础', '中等'],
      required: false,
    },
  ],
  system_prompt: 'sys',
  user_prompt_template: '请围绕 {{topic}} 生成 {{level}} 内容',
  is_active: true,
};

describe('TemplatesPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: {
        id: 'admin-id',
        username: 'admin',
        email: 'a@a.com',
        role: 'admin',
        is_active: true,
      },
      initialized: true,
    });
    vi.mocked(templatesApi.list).mockResolvedValue([TPL]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  it('renders template rows from the API', async () => {
    renderWithProviders(<TemplatesPage />);
    expect(await screen.findByText('章节抽取')).toBeInTheDocument();
    expect(screen.getByText('从文本中抽取章节结构')).toBeInTheDocument();
  });

  it('opens the editor with prefilled values when clicking 编辑', async () => {
    renderWithProviders(<TemplatesPage />);
    await screen.findByText('章节抽取');
    await userEvent.click(screen.getByLabelText('编辑:章节抽取'));
    const modal = await screen.findByTestId('template-editor-modal');
    expect(modal).toBeInTheDocument();
    expect(screen.getByLabelText('模板名称')).toHaveValue('章节抽取');
    expect(screen.getByLabelText('模板描述')).toHaveValue('从文本中抽取章节结构');
    // Variables prefilled
    expect(screen.getByLabelText('变量0-key')).toHaveValue('topic');
    expect(screen.getByLabelText('变量1-key')).toHaveValue('level');
  });

  it('submits create payload and appends row to the table', async () => {
    const created: PromptTemplate = {
      ...TPL,
      id: '00000000-0000-0000-0000-0000000000ff',
      name: '新模板',
      variables: [],
      user_prompt_template: '',
      system_prompt: '',
    };
    vi.mocked(templatesApi.create).mockResolvedValue(created);

    renderWithProviders(<TemplatesPage />);
    await screen.findByText('章节抽取');
    await userEvent.click(screen.getByRole('button', { name: '新建模板' }));
    await screen.findByTestId('template-editor-modal');

    await userEvent.type(screen.getByLabelText('模板名称'), '新模板');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalled();
    });
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0]!;
    expect(payload.name).toBe('新模板');
    await waitFor(() => {
      expect(screen.getByText('新模板')).toBeInTheDocument();
    });
  });

  it('rejects invalid output_schema JSON and shows an inline error', async () => {
    renderWithProviders(<TemplatesPage />);
    await screen.findByText('章节抽取');
    await userEvent.click(screen.getByLabelText('编辑:章节抽取'));
    await screen.findByTestId('template-editor-modal');

    const schemaEditor = screen.getByLabelText('output_schema') as HTMLTextAreaElement;
    fireEvent.change(schemaEditor, { target: { value: 'not json{{' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(templatesApi.update).not.toHaveBeenCalled();
  });

  it('preview dialog renders the template with variable substitutions', async () => {
    renderWithProviders(<TemplatesPage />);
    await screen.findByText('章节抽取');
    await userEvent.click(screen.getByLabelText('预览:章节抽取'));
    const modal = await screen.findByTestId('template-preview-modal');
    expect(modal).toBeInTheDocument();

    // Initially placeholders are visible because variables are empty.
    expect(screen.getByTestId('preview-rendered').textContent).toContain('{{topic}}');

    await userEvent.type(screen.getByLabelText('主题'), '高血压');
    await waitFor(() => {
      expect(screen.getByTestId('preview-rendered').textContent).toContain('高血压');
    });
  });
});
