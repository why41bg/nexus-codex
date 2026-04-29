import { useState } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, primaryBtnClass, cardClass } from '@/lib/styles';
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
        toast(`\u5df2\u6dfb\u52a0\u6a21\u578b ${newModel.trim()}`, 'success');
        setNewModel('');
      } else {
        toast(extractErrorMessage(res.data, '\u6dfb\u52a0\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
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
        toast(`\u5df2\u79fb\u9664\u6a21\u578b ${deleteTarget}`, 'success');
        setDeleteTarget(null);
      } else {
        toast(extractErrorMessage(res.data, '\u79fb\u9664\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`mt-8 ${cardClass} p-6`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">\u5168\u5c40\u9ed8\u8ba4\u6a21\u578b</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        \u5168\u5c40\u9ed8\u8ba4\u6a21\u578b\u5217\u8868\u3002API Key \u672a\u5355\u72ec\u914d\u7f6e\u6a21\u578b\u65f6\uff0c\u5c06\u4f7f\u7528\u6b64\u5217\u8868\u3002\u5ba2\u6237\u7aef\u53ef\u901a\u8fc7{' '}
        <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono text-xs">GET /v1/models</code>{' '}
        \u67e5\u8be2\u53ef\u7528\u6a21\u578b\u3002
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
              title="\u79fb\u9664"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {models.length === 0 && <span className="text-sm text-gray-400 dark:text-slate-500">\u6682\u65e0\u6a21\u578b</span>}
      </div>

      {/* Add model form */}
      <div className="mt-4 flex gap-3 sm:items-end">
        <div className="flex-1 sm:max-w-xs">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u6dfb\u52a0\u6a21\u578b</label>
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addModel()}
            placeholder="\u4f8b\u5982 o4-mini"
            className={inputClass}
          />
        </div>
        <button
          onClick={addModel}
          disabled={!newModel.trim() || adding}
          className={primaryBtnClass}
        >
          {adding && <Spinner className="mr-1.5 h-4 w-4" />}
          \u6dfb\u52a0
        </button>
      </div>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <ConfirmModal
          title="\u786e\u8ba4\u79fb\u9664\u6a21\u578b"
          confirmLabel="\u79fb\u9664"
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            \u786e\u5b9a\u8981\u4ece\u767d\u540d\u5355\u4e2d\u79fb\u9664\u6a21\u578b{' '}
            <span className="font-mono font-semibold">{deleteTarget}</span>{' '}
            \u5417\uff1f\u79fb\u9664\u540e\u5ba2\u6237\u7aef\u5c06\u65e0\u6cd5\u4f7f\u7528\u8be5\u6a21\u578b\u3002
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
