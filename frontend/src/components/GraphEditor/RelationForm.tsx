import { useState } from 'react';
import { RelationType } from '@mkg/shared';
import type { RelationCreateInput, RelationType as RelType } from '@mkg/shared';
import { RELATION_TYPE_LABELS } from './nodeColors';
import { Button } from '../ui';

interface RelationFormProps {
  sourceId: string;
  targetId: string;
  sourceName?: string | undefined;
  targetName?: string | undefined;
  onSubmit: (payload: RelationCreateInput) => Promise<void> | void;
  onCancel: () => void;
}

export function RelationForm({
  sourceId,
  targetId,
  sourceName,
  targetName,
  onSubmit,
  onCancel,
}: RelationFormProps) {
  const [relType, setRelType] = useState<RelType>('RELATED_TO');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: RelationCreateInput = {
        source_id: sourceId,
        target_id: targetId,
        relation_type: relType,
        description: description.trim() || undefined,
        source: 'manual',
      };
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label="新建关系">
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <span style={{ color: '#6b7280' }}>从 </span>
        <strong>{sourceName ?? sourceId}</strong>
        <span style={{ color: '#6b7280' }}> 到 </span>
        <strong>{targetName ?? targetId}</strong>
      </div>
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
          关系类型
        </span>
        <select
          aria-label="关系类型"
          value={relType}
          onChange={(e) => setRelType(e.target.value as RelType)}
          style={selectStyle}
        >
          {RelationType.options.map((t) => (
            <option key={t} value={t}>
              {RELATION_TYPE_LABELS[t]}（{t}）
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
          备注
        </span>
        <textarea
          aria-label="备注"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...selectStyle, resize: 'vertical' }}
        />
      </label>
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

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};
