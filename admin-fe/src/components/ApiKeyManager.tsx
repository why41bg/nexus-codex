import { useState } from 'react';
import type { ApiKey } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { inputClass, primaryBtnClass } from '@/lib/styles';
import { relativeTime } from '@/lib/time';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import { CopyIcon } from './icons';
import EditKeyModal from './EditKeyModal';
import ConfirmModal from './ConfirmModal';
import Spinner from './Spinner';

interface Props {
  apiKeys: ApiKey[];
  models: string[];
  loading: boolean;
  onRefresh: () => void;
}

export default function ApiKeyManager({ apiKeys, models, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();

  const [newKeyName, setNewKeyName] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [lastCreatedKey, setLastCreatedKey] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    toast('已复制到剪贴板', 'success');
  };

  const addKey = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setAddingKey(true);
    setLastCreatedKey(null);
    try {
      const res = await api<{ key: string }>('POST', '/api/admin/keys', {
        name: newKeyName.trim(),
        models: [],
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        setLastCreatedKey(res.data.key);
        setNewKeyName('');
        toast('API Key 已生成', 'success');
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '生成失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setAddingKey(false);
    }
  };

  const doDeleteKey = async () => {
    if (!deleteTarget) return;
    setDeletingKey(true);
    try {
      const res = await api('DELETE', `/api/admin/keys/${encodeURIComponent(deleteTarget.keyPrefix)}`);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('API Key 已删除', 'success');
        setDeleteTarget(null);
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '删除失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setDeletingKey(false);
    }
  };

  return (
    <div className="mt-8 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="text-sm font-semibold text-gray-900">API Key 管理</h2>
      <p className="mt-1 text-xs text-gray-500">
        管理 API Key 访问权限。每个 Key 可独立配置允许使用的模型列表，未配置时继承全局默认模型。
      </p>

      {/* Key List */}
      <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-gray-200">
        {loading && apiKeys.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <Spinner className="h-5 w-5 text-brand-600" />
            <span className="ml-2 text-sm text-gray-500">加载中...</span>
          </div>
        )}

        {!loading && apiKeys.length === 0 && (
          <div className="py-10 text-center text-sm text-gray-400">
            暂无 API Key，请添加至少一个 Key 以启用鉴权
          </div>
        )}

        {apiKeys.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/60">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500">名称</th>
                <th className="px-4 py-3 font-medium text-gray-500">Key</th>
                <th className="px-4 py-3 font-medium text-gray-500">可用模型</th>
                <th className="px-4 py-3 font-medium text-gray-500">创建时间</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apiKeys.map((k) => (
                <tr key={k.keyPrefix} className="transition-colors hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-700">{k.name || '\u2014'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-gray-600">
                        {k.keyMasked}
                      </span>
                      <button
                        onClick={() => handleCopy(k.keyMasked)}
                        className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        title="复制脱敏 Key"
                      >
                        <CopyIcon />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {k.models.length === 0 ? (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">继承全局默认</span>
                      ) : (
                        k.effectiveModels.map((m) => (
                          <span
                            key={m}
                            className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200"
                          >
                            {m}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{relativeTime(k.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditTarget(k)}
                        className="rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteTarget(k)}
                        className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Key Form */}
      <div className="mt-5 rounded-lg border border-dashed border-gray-300 p-4">
        <h3 className="text-xs font-semibold text-gray-700">生成新 Key</h3>
        <p className="mt-1 text-xs text-gray-400">
          系统将自动生成 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">sk-</code> 前缀的安全随机 Key
        </p>
        <form onSubmit={addKey} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 sm:max-w-xs">
            <label className="mb-1 block text-xs font-medium text-gray-600">名称/备注</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="例如 my-app"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={addingKey}
            className={primaryBtnClass}
          >
            {addingKey && <Spinner className="mr-1.5 h-4 w-4" />}
            生成
          </button>
        </form>

        {/* Newly created key display */}
        {lastCreatedKey && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-xs font-medium text-green-800">
              Key 已生成，请立即复制保存（之后将无法再次查看完整内容）：
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 rounded bg-white px-3 py-1.5 font-mono text-sm text-green-900 ring-1 ring-green-200">
                {lastCreatedKey}
              </code>
              <button
                onClick={() => handleCopy(lastCreatedKey)}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700"
              >
                复制
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Key Modal */}
      {editTarget && (
        <EditKeyModal
          target={editTarget}
          globalModels={models}
          onClose={() => setEditTarget(null)}
          onSaved={onRefresh}
        />
      )}

      {/* Delete Key Confirm Modal */}
      {deleteTarget && (
        <ConfirmModal
          title="确认删除 API Key"
          confirmLabel="删除"
          loading={deletingKey}
          onConfirm={doDeleteKey}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            确定要删除 API Key{' '}
            <span className="font-mono font-semibold">{deleteTarget.keyMasked}</span>
            {deleteTarget.name && <span>（{deleteTarget.name}）</span>}
            吗？删除后使用该 Key 的客户端将无法访问。
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
