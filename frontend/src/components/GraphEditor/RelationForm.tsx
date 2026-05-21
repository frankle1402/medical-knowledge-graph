import { useState } from 'react';
import { RelationType, NodeStatus } from '@mkg/shared';
import type {
  RelationCreateInput,
  RelationType as RelType,
  NodeStatus as NodeStatusType,
} from '@mkg/shared';
import { RELATION_TYPE_LABELS } from './nodeColors';
import { Button } from '../ui';

export interface RelationEditPatch {
  relation_type: RelType;
  description?: string;
  confidence?: number;
  status: NodeStatusType;
}

interface CommonProps {
  sourceId: string;
  targetId: string;
  sourceName?: string | undefined;
  targetName?: string | undefined;
  onCancel: () => void;
}

interface CreateProps extends CommonProps {
  mode?: 'create';
  initial?: undefined;
  onSubmit: (payload: RelationCreateInput) => Promise<void> | void;
}

interface EditProps extends CommonProps {
  mode: 'edit';
  initial: RelationEditPatch;
  onSubmit: (payload: RelationEditPatch) => Promise<void> | void;
}

type RelationFormProps = CreateProps | EditProps;

export function RelationForm(props: RelationFormProps) {
  const { sourceId, targetId, sourceName, targetName, onCancel } = props;
  const isEdit = props.mode === 'edit';

  const [relType, setRelType] = useState<RelType>(
    isEdit ? props.initial.relation_type : 'RELATED_TO',
  );
  const [description, setDescription] = useState(isEdit ? props.initial.description ?? '' : '');
  const [confidence, setConfidence] = useState<number>(
    isEdit ? props.initial.confidence ?? 1 : 1,
  );
  const [status, setStatus] = useState<NodeStatusType>(
    isEdit ? props.initial.status : 'candidate',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isEdit) {
        const trimmed = description.trim();
        const patch: RelationEditPatch = {
          relation_type: relType,
          confidence,
          status,
          ...(trimmed ? { description: trimmed } : {}),
        };
        await (props as EditProps).onSubmit(patch);
      } else {
        const payload: RelationCreateInput = {
          source_id: sourceId,
          target_id: targetId,
          relation_type: relType,
          description: description.trim() || undefined,
          source: 'manual',
        };
        await (props as CreateProps).onSubmit(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label={isEdit ? '编辑关系' : '新建关系'}>
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <span style={{ color: '#6b7280' }}>从 </span>
        <strong>{sourceName ?? sourceId}</strong>
        <span style={{ color: '#6b7280' }}> 到 </span>
        <strong>{targetName ?? targetId}</strong>
        {isEdit ? (
          <span style={{ color: '#9ca3af', marginLeft: 8, fontSize: 11 }}>
            （端点不可修改）
          </span>
        ) : null}
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
          {RelationType.options
            .filter((t) => t !== 'BELONGS_TO_GRAPH')
            .map((t) => (
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
      {isEdit ? (
        <>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
              置信度
            </span>
            <input
              aria-label="置信度"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              style={selectStyle}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
              状态
            </span>
            <select
              aria-label="状态"
              value={status}
              onChange={(e) => setStatus(e.target.value as NodeStatusType)}
              style={selectStyle}
            >
              {NodeStatus.options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
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
