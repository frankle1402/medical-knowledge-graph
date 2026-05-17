import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Graph, GraphCreateInput } from '@mkg/shared';
import { authApi, graphsApi } from '../api';
import { Button, Modal } from '../components/ui';
import { useAuthStore } from '../stores';

export function GraphListPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [graphs, setGraphs] = useState<Graph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await graphsApi.list();
      setGraphs(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleDelete = async (g: Graph) => {
    if (!confirm(`删除图谱 "${g.graph_name}"? 此操作不可恢复。`)) return;
    try {
      await graphsApi.remove(g.graph_id);
      setGraphs((prev) => prev.filter((x) => x.graph_id !== g.graph_id));
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: '#111827' }}>医学知识图谱平台</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            欢迎，{user?.username ?? 'Anonymous'}（{user?.role ?? '-'}）
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setCreateOpen(true)}>新建图谱</Button>
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
      ) : graphs.length === 0 ? (
        <div
          style={{
            background: 'white',
            border: '1px dashed #d1d5db',
            borderRadius: 8,
            padding: 48,
            textAlign: 'center',
            color: '#6b7280',
          }}
        >
          暂无图谱，点击右上角"新建图谱"创建第一个图谱。
        </div>
      ) : (
        <div
          data-testid="graph-list"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {graphs.map((g) => (
            <GraphCard key={g.graph_id} graph={g} onDelete={() => handleDelete(g)} />
          ))}
        </div>
      )}

      <CreateGraphModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(g) => {
          setCreateOpen(false);
          setGraphs((prev) => [g, ...prev]);
          navigate(`/graphs/${encodeURIComponent(g.graph_id)}`);
        }}
      />
    </div>
  );
}

function GraphCard({ graph, onDelete }: { graph: Graph; onDelete: () => void }) {
  return (
    <article
      data-testid={`graph-card-${graph.graph_id}`}
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15, color: '#111827' }}>
        <Link
          to={`/graphs/${encodeURIComponent(graph.graph_id)}`}
          style={{ color: '#1d4ed8', textDecoration: 'none' }}
        >
          {graph.graph_name}
        </Link>
      </h3>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        {graph.graph_type} · {graph.subject ?? '-'}
      </div>
      {graph.description ? (
        <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>{graph.description}</p>
      ) : null}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        }}
      >
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {graph.node_count} 节点 · {graph.relation_count} 关系
        </div>
        <Button
          size="sm"
          variant="danger"
          onClick={onDelete}
          aria-label={`删除 ${graph.graph_name}`}
        >
          删除
        </Button>
      </div>
    </article>
  );
}

interface CreateGraphModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (graph: Graph) => void;
}

function CreateGraphModal({ open, onClose, onCreated }: CreateGraphModalProps) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setSubject('');
    setDescription('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('图谱名称不能为空');
      return;
    }
    setSubmitting(true);
    try {
      const payload: GraphCreateInput = {
        graph_name: name.trim(),
        graph_type: 'course',
        subject: subject.trim() || undefined,
        description: description.trim() || undefined,
      };
      const created = await graphsApi.create(payload);
      reset();
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="新建图谱"
      onClose={() => {
        reset();
        onClose();
      }}
      testId="create-graph-modal"
    >
      <form onSubmit={handleSubmit} aria-label="新建图谱">
        <Field label="图谱名称">
          <input
            aria-label="图谱名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="学科">
          <input
            aria-label="学科"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
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
        {error ? (
          <div role="alert" style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
          >
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </Button>
        </div>
      </form>
    </Modal>
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
