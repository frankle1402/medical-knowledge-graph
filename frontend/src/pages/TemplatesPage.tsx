import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  PromptTemplate,
  PromptTemplateCreateInput,
  TemplateVariable,
} from '@mkg/shared';
import { authApi, templatesApi } from '../api';
import { Button, MonacoCodeEditor, Modal, Toaster, toast } from '../components/ui';
import { TemplateVariableEditor, type VariableValue } from '../components/TemplateVariableEditor';
import { useAuthStore } from '../stores';

type EditMode = { kind: 'create' } | { kind: 'edit'; template: PromptTemplate } | null;

export function TemplatesPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await templatesApi.list();
      setTemplates(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleDelete = async (t: PromptTemplate) => {
    if (!confirm(`删除模板 "${t.name}"？此操作不可恢复。`)) return;
    try {
      await templatesApi.remove(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast.success(`已删除模板 ${t.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    logout();
    navigate('/login', { replace: true });
  };

  const handleSaved = (t: PromptTemplate, kind: 'create' | 'edit') => {
    if (kind === 'create') {
      setTemplates((prev) => [...prev, t]);
      toast.success(`已创建模板 ${t.name}`);
    } else {
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      toast.success(`已保存模板 ${t.name}`);
    }
    setEditMode(null);
  };

  return (
    <div
      style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}
      data-testid="templates-page"
    >
      <Toaster richColors position="top-right" />
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: '#111827' }}>提示词模板</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            维护 AI 生成图谱时使用的提示词模板及其变量。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => navigate('/graphs')}>
            返回图谱列表
          </Button>
          <Button onClick={() => setEditMode({ kind: 'create' })}>新建模板</Button>
          <Button variant="secondary" onClick={handleLogout}>
            退出
          </Button>
        </div>
      </header>

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中…</p>
      ) : error ? (
        <p role="alert" style={{ color: '#DC2626' }}>
          {error}
        </p>
      ) : (
        <div
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table
            data-testid="templates-table"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>说明</th>
                <th style={thStyle}>变量</th>
                <th style={thStyle}>状态</th>
                <th style={{ ...thStyle, width: 220 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={tdStyle}>{t.name}</td>
                  <td style={{ ...tdStyle, color: '#6b7280', maxWidth: 280 }}>
                    {t.description ?? '—'}
                  </td>
                  <td style={tdStyle}>{t.variables.length}</td>
                  <td style={tdStyle}>
                    {t.is_active === false ? (
                      <span style={{ color: '#9ca3af' }}>已停用</span>
                    ) : (
                      <span style={{ color: '#059669' }}>启用</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setPreviewTemplate(t)}
                        aria-label={`预览:${t.name}`}
                      >
                        预览
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditMode({ kind: 'edit', template: t })}
                        aria-label={`编辑:${t.name}`}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDelete(t)}
                        aria-label={`删除:${t.name}`}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af' }}>
                    暂无模板
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {editMode ? (
        <TemplateEditorDialog
          mode={editMode}
          onClose={() => setEditMode(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {previewTemplate ? (
        <TemplatePreviewDialog
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
        />
      ) : null}
    </div>
  );
}

interface TemplateEditorDialogProps {
  mode: { kind: 'create' } | { kind: 'edit'; template: PromptTemplate };
  onClose: () => void;
  onSaved: (template: PromptTemplate, kind: 'create' | 'edit') => void;
}

function TemplateEditorDialog({ mode, onClose, onSaved }: TemplateEditorDialogProps) {
  const initial: PromptTemplateCreateInput = useMemo(() => {
    if (mode.kind === 'edit') {
      const t = mode.template;
      return {
        name: t.name,
        description: t.description,
        variables: t.variables,
        system_prompt: t.system_prompt,
        user_prompt_template: t.user_prompt_template,
        output_schema: t.output_schema,
      };
    }
    return {
      name: '',
      description: '',
      variables: [],
      system_prompt: '',
      user_prompt_template: '',
      output_schema: undefined,
    };
  }, [mode]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [variables, setVariables] = useState<TemplateVariable[]>(initial.variables);
  const [systemPrompt, setSystemPrompt] = useState(initial.system_prompt);
  const [userPrompt, setUserPrompt] = useState(initial.user_prompt_template);
  const [outputSchemaText, setOutputSchemaText] = useState(
    initial.output_schema ? JSON.stringify(initial.output_schema, null, 2) : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const addVariable = () => {
    setVariables((prev) => [
      ...prev,
      { key: `var_${prev.length + 1}`, label: '', type: 'text', required: false },
    ]);
  };

  const updateVariable = (i: number, patch: Partial<TemplateVariable>) => {
    setVariables((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };

  const removeVariable = (i: number) => {
    setVariables((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSchemaError(null);

    let outputSchema: Record<string, unknown> | undefined;
    if (outputSchemaText.trim() !== '') {
      try {
        const parsed = JSON.parse(outputSchemaText);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('output_schema 必须是 JSON 对象');
        }
        outputSchema = parsed as Record<string, unknown>;
      } catch (err) {
        setSchemaError(err instanceof Error ? err.message : 'JSON 解析失败');
        setSubmitting(false);
        return;
      }
    }

    const payload: PromptTemplateCreateInput = {
      name,
      description: description || undefined,
      variables,
      system_prompt: systemPrompt,
      user_prompt_template: userPrompt,
      output_schema: outputSchema,
    };

    try {
      if (mode.kind === 'create') {
        const created = await templatesApi.create(payload);
        onSaved(created, 'create');
      } else {
        const updated = await templatesApi.update(mode.template.id, payload);
        onSaved(updated, 'edit');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title={mode.kind === 'create' ? '新建模板' : `编辑模板：${mode.template.name}`}
      onClose={onClose}
      testId="template-editor-modal"
    >
      <form onSubmit={handleSubmit} aria-label="模板编辑表单" style={{ width: 600 }}>
        <Field label="名称">
          <input
            aria-label="模板名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="描述">
          <input
            aria-label="模板描述"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Section title="变量">
          {variables.length === 0 ? (
            <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0' }}>暂无变量。</p>
          ) : null}
          {variables.map((v, i) => (
            <div
              key={i}
              data-testid={`variable-row-${i}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 120px 80px 32px',
                gap: 6,
                marginBottom: 6,
                alignItems: 'center',
              }}
            >
              <input
                aria-label={`变量${i}-key`}
                placeholder="key"
                value={v.key}
                onChange={(e) => updateVariable(i, { key: e.target.value })}
                style={inputStyle}
              />
              <input
                aria-label={`变量${i}-label`}
                placeholder="label"
                value={v.label}
                onChange={(e) => updateVariable(i, { label: e.target.value })}
                style={inputStyle}
              />
              <select
                aria-label={`变量${i}-type`}
                value={v.type}
                onChange={(e) =>
                  updateVariable(i, { type: e.target.value as TemplateVariable['type'] })
                }
                style={inputStyle}
              >
                <option value="text">text</option>
                <option value="textarea">textarea</option>
                <option value="select">select</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <label
                style={{
                  fontSize: 12,
                  color: '#374151',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`变量${i}-required`}
                  checked={v.required ?? false}
                  onChange={(e) => updateVariable(i, { required: e.target.checked })}
                />
                必填
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => removeVariable(i)}
                aria-label={`删除变量${i}`}
              >
                ×
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={addVariable}>
            + 新增变量
          </Button>
        </Section>

        <Section title="系统提示词 (system_prompt)">
          <MonacoCodeEditor
            value={systemPrompt}
            onChange={setSystemPrompt}
            language="plaintext"
            height={140}
            ariaLabel="系统提示词"
            testId="system-prompt-editor"
          />
        </Section>

        <Section title="用户提示词模板 (user_prompt_template)">
          <MonacoCodeEditor
            value={userPrompt}
            onChange={setUserPrompt}
            language="plaintext"
            height={180}
            ariaLabel="用户提示词模板"
            testId="user-prompt-editor"
          />
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            可使用 {'{{variable}}'} 占位符引用上方变量。
          </p>
        </Section>

        <Section title="output_schema (可选 JSON)">
          <MonacoCodeEditor
            value={outputSchemaText}
            onChange={setOutputSchemaText}
            language="json"
            height={180}
            ariaLabel="output_schema"
            testId="output-schema-editor"
          />
          {schemaError ? (
            <p role="alert" style={{ fontSize: 12, color: '#DC2626', marginTop: 4 }}>
              {schemaError}
            </p>
          ) : null}
        </Section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface TemplatePreviewDialogProps {
  template: PromptTemplate;
  onClose: () => void;
}

function TemplatePreviewDialog({ template, onClose }: TemplatePreviewDialogProps) {
  const [values, setValues] = useState<Record<string, VariableValue>>({});
  const setVar = (key: string, value: VariableValue) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const rendered = useMemo(() => {
    let out = template.user_prompt_template;
    for (const v of template.variables) {
      const raw = values[v.key];
      const str = raw === undefined || raw === '' ? `{{${v.key}}}` : String(raw);
      const re = new RegExp(`\\{\\{\\s*${escapeRegExp(v.key)}\\s*\\}\\}`, 'g');
      out = out.replace(re, str);
    }
    return out;
  }, [template, values]);

  return (
    <Modal
      open
      title={`预览：${template.name}`}
      onClose={onClose}
      testId="template-preview-modal"
    >
      <div style={{ width: 600 }}>
        <Section title="变量">
          <TemplateVariableEditor
            variables={template.variables}
            values={values}
            onChange={setVar}
          />
        </Section>
        <Section title="渲染后的用户提示词">
          <pre
            data-testid="preview-rendered"
            style={{
              background: '#f3f4f6',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              maxHeight: 240,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {rendered}
          </pre>
        </Section>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '8px 0 6px', fontSize: 12, color: '#374151', fontWeight: 600 }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: '#6b7280',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#111827',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};
