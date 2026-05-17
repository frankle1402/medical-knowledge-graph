import { useEffect, useState } from 'react';
import { NodeType, KnowledgeType } from '@mkg/shared';
import type { Node as KGNode, NodeCreateInput, NodeUpdateInput } from '@mkg/shared';
import { NODE_TYPE_LABELS } from './nodeColors';
import { Button } from '../ui';

export type NodeFormMode = 'create' | 'edit';

export interface NodeFormValues {
  node_type: KGNode['node_type'];
  name: string;
  description?: string;
  knowledge_type?: KGNode['node_type'] extends 'knowledge_point' ? string : string;
  tags?: string;
}

interface NodeFormProps {
  mode: NodeFormMode;
  initial?: Partial<KGNode>;
  onSubmit: (
    payload: NodeCreateInput | NodeUpdateInput,
    mode: NodeFormMode,
  ) => Promise<void> | void;
  onCancel: () => void;
}

export function NodeForm({ mode, initial, onSubmit, onCancel }: NodeFormProps) {
  const [nodeType, setNodeType] = useState<KGNode['node_type']>(
    (initial?.node_type as KGNode['node_type']) ?? 'knowledge_point',
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [knowledgeType, setKnowledgeType] = useState<string>(
    (initial as { knowledge_type?: string } | undefined)?.knowledge_type ??
      KnowledgeType.options[0],
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
  }, [nodeType, name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('名称不能为空');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const payload: NodeCreateInput = {
          node_type: nodeType,
          name: name.trim(),
          description: description.trim() || undefined,
          tags: tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          source: 'manual',
        };
        if (nodeType === 'knowledge_point') {
          (payload as Record<string, unknown>)['knowledge_type'] = knowledgeType;
        }
        await onSubmit(payload, mode);
      } else {
        const payload: NodeUpdateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          tags: tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        };
        await onSubmit(payload, mode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label={mode === 'create' ? '新建节点' : '编辑节点'}>
      <Field label="类型">
        <select
          aria-label="节点类型"
          value={nodeType}
          disabled={mode === 'edit'}
          onChange={(e) => setNodeType(e.target.value as KGNode['node_type'])}
          style={inputStyle}
        >
          {NodeType.options.map((t) => (
            <option key={t} value={t}>
              {NODE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="名称">
        <input
          aria-label="名称"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="描述">
        <textarea
          aria-label="描述"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>
      {nodeType === 'knowledge_point' && mode === 'create' ? (
        <Field label="知识分类">
          <select
            aria-label="知识分类"
            value={knowledgeType}
            onChange={(e) => setKnowledgeType(e.target.value)}
            style={inputStyle}
          >
            {KnowledgeType.options.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="标签 (英文逗号分隔)">
        <input
          aria-label="标签"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          style={inputStyle}
        />
      </Field>
      {error ? (
        <div role="alert" style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? '提交中…' : '保存'}
        </Button>
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};

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
