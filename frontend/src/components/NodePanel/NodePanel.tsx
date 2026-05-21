import type { Node as KGNode, Relation } from '@mkg/shared';
import { Button } from '../ui';
import { NODE_TYPE_LABELS, RELATION_TYPE_LABELS } from '../GraphEditor/nodeColors';
import { asTagsObject } from '../GraphEditor/tags';

interface NodePanelProps {
  selectedNode: KGNode | null;
  selectedRelation: Relation | null;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteRelation: () => void;
  onFocusNode?: (nodeId: string) => void;
  onShowLearningPath?: (nodeId: string) => void;
}

export function NodePanel({
  selectedNode,
  selectedRelation,
  onEdit,
  onDelete,
  onDeleteRelation,
  onFocusNode,
  onShowLearningPath,
}: NodePanelProps) {
  if (selectedNode) {
    const tagsObj = asTagsObject(selectedNode.tags);
    const legacyChips = Array.isArray(tagsObj._legacy)
      ? (tagsObj._legacy as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const v2Pairs = Object.entries(tagsObj).filter(([k]) => k !== '_legacy');
    return (
      <div data-testid="node-panel" style={panelStyle}>
        <h3 style={titleStyle}>节点详情</h3>
        <KV label="ID" value={selectedNode.node_id} mono />
        <KV label="类型" value={NODE_TYPE_LABELS[selectedNode.node_type]} />
        <KV label="名称" value={selectedNode.name} />
        <KV label="状态" value={selectedNode.status} />
        <KV label="来源" value={selectedNode.source} />
        <KV label="置信度" value={Number(selectedNode.confidence ?? 1).toFixed(2)} />
        {selectedNode.description ? (
          <KV label="描述" value={selectedNode.description} multiline />
        ) : null}
        {legacyChips.length > 0 ? (
          <KV label="标签" value={legacyChips.join(', ')} />
        ) : null}
        {v2Pairs.length > 0 ? (
          <KV
            label="扩展字段"
            value={v2Pairs
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
              .join('\n')}
            multiline
          />
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button onClick={onEdit}>编辑</Button>
          <Button variant="danger" onClick={onDelete}>
            删除
          </Button>
          {onFocusNode ? (
            <Button
              variant="secondary"
              onClick={() => onFocusNode(selectedNode.node_id)}
              data-testid="focus-node-btn"
            >
              🎯 只看这个
            </Button>
          ) : null}
          {onShowLearningPath ? (
            <Button
              variant="secondary"
              onClick={() => onShowLearningPath(selectedNode.node_id)}
              data-testid="show-learning-path-btn"
            >
              📚 学习路径
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (selectedRelation) {
    return (
      <div data-testid="node-panel" style={panelStyle}>
        <h3 style={titleStyle}>关系详情</h3>
        <KV label="ID" value={selectedRelation.relation_id ?? '(待保存)'} mono />
        <KV label="类型" value={RELATION_TYPE_LABELS[selectedRelation.relation_type]} />
        <KV label="源" value={selectedRelation.source_id} mono />
        <KV label="目标" value={selectedRelation.target_id} mono />
        <KV label="状态" value={selectedRelation.status} />
        <KV label="置信度" value={Number(selectedRelation.confidence ?? 1).toFixed(2)} />
        {selectedRelation.description ? (
          <KV label="备注" value={selectedRelation.description} multiline />
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="danger" onClick={onDeleteRelation}>
            删除关系
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="node-panel" style={panelStyle}>
      <p style={{ color: '#6b7280', fontSize: 13 }}>在画布中选择节点或关系以查看详情。</p>
      <p style={{ color: '#6b7280', fontSize: 12, marginTop: 12 }}>
        提示：双击空白处可新建节点；从节点边缘拖出可创建关系。
      </p>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  height: '100%',
  background: 'white',
  borderLeft: '1px solid #e5e7eb',
  padding: 16,
  overflowY: 'auto',
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  marginTop: 0,
  marginBottom: 12,
  color: '#111827',
};

function KV({
  label,
  value,
  mono,
  multiline,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontSize: 13,
          color: '#111827',
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
            : undefined,
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}
