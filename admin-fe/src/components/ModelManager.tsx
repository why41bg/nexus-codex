import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, primaryBtnClass, cardClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import ConfirmModal from './ConfirmModal';
import Spinner from './Spinner';

interface Props {
  models: string[];
}

export default function ModelManager({ models }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newModel, setNewModel] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const addModel = async () => {
    if (!newModel.trim()) return;
    setAdding(true);
    try {
      const res = await api<{ models: string[] }>('POST', '/api/admin/models', { model: newModel.trim() });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
        toast(`已添加模型 ${newModel.trim()}`, 'success');
        setNewModel('');
      } else {
        toast(extractErrorMessage(res.data, '添加失败'), 'error');
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
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
        toast(`已移除模型 ${deleteTarget}`, 'success');
        setDeleteTarget(null);
      } else {
        toast(extractErrorMessage(res.data, '移除失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`mt-8 ${cardClass} p-6`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">全局默认模型</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        全局默认模型列表。API Key 未单独配置模型时，将使用此列表。客户端可通过{' '}
        <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono text-xs">GET /v1/models</code>{' '}
        查询可用模型。
      </p>

      {/* Model tags */}
      <div className="mt-4 flex flex-wrap gap-2">
        {models.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 dark:bg-brand-950 px-3 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800"
          >
            {m}
            <button
              onClick={() => setDeleteTarget(m)}
              className="ml-0.5 rounded-full p-0.5 text-brand-400 transition-colors hover:bg-brand-100 dark:hover:bg-brand-900 hover:text-brand-600 dark:hover:text-brand-200"
              title="移除"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {models.length === 0 && <span className="text-sm text-gray-400 dark:text-slate-500">暂无模型</span>}
      </div>

      {/* Add model form */}
      <div className="mt-4 flex gap-3 sm:items-end">
        <div className="flex-1 sm:max-w-xs">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">添加模型</label>
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addModel()}
            placeholder="例如 o4-mini"
            className={inputClass}
          />
        </div>
        <button
          onClick={addModel}
          disabled={!newModel.trim() || adding}
          className={primaryBtnClass}
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
