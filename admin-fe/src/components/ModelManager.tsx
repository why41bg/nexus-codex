import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import Spinner from './Spinner';

interface Props {
  models: string[];
  onModelsChange: (models: string[]) => void;
}

export default function ModelManager({ models, onModelsChange }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [newModel, setNewModel] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const addModel = async () => {
    if (!newModel.trim()) return;
    setAdding(true);
    try {
      const res = await api<{ models: string[] }>('POST', '/api/admin/models', { model: newModel.trim() });
      if (authGuard(res.status)) return;
      if (res.ok) {
        onModelsChange(res.data.models || []);
        toast(`已添加模型 ${newModel.trim()}`, 'success');
        setNewModel('');
      } else {
        const d = res.data as unknown as { error?: { message?: string } };
        toast(d?.error?.message || '添加失败', 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setAdding(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api<{ models: string[] }>('DELETE', `/api/admin/models/${encodeURIComponent(deleteTarget)}`);
      if (authGuard(res.status)) return;
      if (res.ok) {
        onModelsChange(res.data.models || []);
        toast(`已移除模型 ${deleteTarget}`, 'success');
        setDeleteTarget(null);
      } else {
        const d = res.data as unknown as { error?: { message?: string } };
        toast(d?.error?.message || '移除失败', 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-8 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="text-sm font-semibold text-gray-900">全局默认模型</h2>
      <p className="mt-1 text-xs text-gray-500">
        全局默认模型列表。API Key 未单独配置模型时，将使用此列表。客户端可通过{' '}
        <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">GET /v1/models</code>{' '}
        查询可用模型。
      </p>

      {/* Model tags */}
      <div className="mt-4 flex flex-wrap gap-2">
        {models.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-brand-200"
          >
            {m}
            <button
              onClick={() => setDeleteTarget(m)}
              className="ml-0.5 rounded-full p-0.5 text-brand-400 transition-colors hover:bg-brand-100 hover:text-brand-600"
              title="移除"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {models.length === 0 && <span className="text-sm text-gray-400">暂无模型</span>}
      </div>

      {/* Add model form */}
      <div className="mt-4 flex gap-3 sm:items-end">
        <div className="flex-1 sm:max-w-xs">
          <label className="mb-1 block text-xs font-medium text-gray-600">添加模型</label>
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addModel()}
            placeholder="例如 o4-mini"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <button
          onClick={addModel}
          disabled={!newModel.trim() || adding}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50"
        >
          {adding && <Spinner className="mr-1.5 h-4 w-4" />}
          添加
        </button>
      </div>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <ConfirmModal
          title="确认移除模型"
          confirmLabel="移除"
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            确定要从白名单中移除模型{' '}
            <span className="font-mono font-semibold">{deleteTarget}</span>{' '}
            吗？移除后客户端将无法使用该模型。
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
