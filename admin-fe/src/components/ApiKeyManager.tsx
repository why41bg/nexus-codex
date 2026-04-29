import { useState } from 'react';
import type { ApiKey } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { inputClass, primaryBtnClass, cardClass } from '@/lib/styles';
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
    toast('\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f', 'success');
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
        toast('API Key \u5df2\u751f\u6210', 'success');
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '\u751f\u6210\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
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
        toast('API Key \u5df2\u5220\u9664', 'success');
        setDeleteTarget(null);
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '\u5220\u9664\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setDeletingKey(false);
    }
  };

  return (
    <div className={`mt-8 ${cardClass} p-6`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">API Key \u7ba1\u7406</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        \u7ba1\u7406 API Key \u8bbf\u95ee\u6743\u9650\u3002\u6bcf\u4e2a Key \u53ef\u72ec\u7acb\u914d\u7f6e\u5141\u8bb8\u4f7f\u7528\u7684\u6a21\u578b\u5217\u8868\uff0c\u672a\u914d\u7f6e\u65f6\u7ee7\u627f\u5168\u5c40\u9ed8\u8ba4\u6a21\u578b\u3002
      </p>

      {/* Key List */}
      {loading && apiKeys.length === 0 && (
        <div className="mt-4 flex items-center justify-center py-10">
          <Spinner className="h-5 w-5 text-brand-600" />
          <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">\u52a0\u8f7d\u4e2d...</span>
        </div>
      )}

      {!loading && apiKeys.length === 0 && (
        <div className="mt-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
          \u6682\u65e0 API Key\uff0c\u8bf7\u6dfb\u52a0\u81f3\u5c11\u4e00\u4e2a Key \u4ee5\u542f\u7528\u9274\u6743
        </div>
      )}

      {apiKeys.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className={`mt-4 hidden overflow-hidden ${cardClass} md:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u540d\u79f0</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Key</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u53ef\u7528\u6a21\u578b</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u9650\u5236</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u521b\u5efa\u65f6\u95f4</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-slate-400">\u64cd\u4f5c</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {apiKeys.map((k) => (
                  <tr key={k.keyPrefix} className="transition-colors hover:bg-gray-50/50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{k.name || '\u2014'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-600 dark:text-slate-400">{k.keyMasked}</span>
                        <button
                          onClick={() => handleCopy(k.keyMasked)}
                          className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                          title="\u590d\u5236\u8131\u654f Key"
                        >
                          <CopyIcon />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {k.models.length === 0 ? (
                          <span className="rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs text-gray-500 dark:text-slate-400">\u7ee7\u627f\u5168\u5c40\u9ed8\u8ba4</span>
                        ) : (
                          k.effectiveModels.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800"
                            >
                              {m}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <KeyRestrictionTags apiKey={k} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{relativeTime(k.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditTarget(k)}
                          className="rounded-md bg-brand-50 dark:bg-brand-950 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-900"
                        >
                          \u7f16\u8f91
                        </button>
                        <button
                          onClick={() => setDeleteTarget(k)}
                          className="rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
                        >
                          \u5220\u9664
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List */}
          <div className="mt-4 space-y-3 md:hidden">
            {apiKeys.map((k) => (
              <div key={k.keyPrefix} className={`${cardClass} p-4`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{k.name || '\u2014'}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-400">{k.keyMasked}</span>
                    <button
                      onClick={() => handleCopy(k.keyMasked)}
                      className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {k.models.length === 0 ? (
                    <span className="rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs text-gray-500 dark:text-slate-400">\u7ee7\u627f\u5168\u5c40\u9ed8\u8ba4</span>
                  ) : (
                    k.effectiveModels.map((m) => (
                      <span
                        key={m}
                        className="rounded bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800"
                      >
                        {m}
                      </span>
                    ))
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  <KeyRestrictionTags apiKey={k} />
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-gray-100 dark:border-slate-700 pt-3">
                  <span className="text-xs text-gray-400 dark:text-slate-500">{relativeTime(k.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditTarget(k)}
                      className="rounded-md bg-brand-50 dark:bg-brand-950 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-900"
                    >
                      \u7f16\u8f91
                    </button>
                    <button
                      onClick={() => setDeleteTarget(k)}
                      className="rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
                    >
                      \u5220\u9664
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add Key Form */}
      <div className="mt-5 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-4">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-slate-300">\u751f\u6210\u65b0 Key</h3>
        <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
          \u7cfb\u7edf\u5c06\u81ea\u52a8\u751f\u6210 <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono">sk-</code> \u524d\u7f00\u7684\u5b89\u5168\u968f\u673a Key
        </p>
        <form onSubmit={addKey} className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 md:max-w-xs">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u540d\u79f0/\u5907\u6ce8</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="\u4f8b\u5982 my-app"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={addingKey}
            className={primaryBtnClass}
          >
            {addingKey && <Spinner className="mr-1.5 h-4 w-4" />}
            \u751f\u6210
          </button>
        </form>

        {lastCreatedKey && (
          <div className="mt-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 p-3">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">
              Key \u5df2\u751f\u6210\uff0c\u8bf7\u7acb\u5373\u590d\u5236\u4fdd\u5b58\uff08\u4e4b\u540e\u5c06\u65e0\u6cd5\u518d\u6b21\u67e5\u770b\u5b8c\u6574\u5185\u5bb9\uff09\uff1a
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 rounded bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-sm text-green-900 dark:text-green-200 ring-1 ring-green-200 dark:ring-green-800">
                {lastCreatedKey}
              </code>
              <button
                onClick={() => handleCopy(lastCreatedKey)}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700"
              >
                \u590d\u5236
              </button>
            </div>
          </div>
        )}
      </div>

      {editTarget && (
        <EditKeyModal
          target={editTarget}
          globalModels={models}
          onClose={() => setEditTarget(null)}
          onSaved={onRefresh}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="\u786e\u8ba4\u5220\u9664 API Key"
          confirmLabel="\u5220\u9664"
          loading={deletingKey}
          onConfirm={doDeleteKey}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            \u786e\u5b9a\u8981\u5220\u9664 API Key{' '}
            <span className="font-mono font-semibold">{deleteTarget.keyMasked}</span>
            {deleteTarget.name && <span>\uff08{deleteTarget.name}\uff09</span>}
            \u5417\uff1f\u5220\u9664\u540e\u4f7f\u7528\u8be5 Key \u7684\u5ba2\u6237\u7aef\u5c06\u65e0\u6cd5\u8bbf\u95ee\u3002
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

// \u2500\u2500\u2500 \u9650\u5236 Tag \u5b50\u7ec4\u4ef6 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function KeyRestrictionTags({ apiKey }: { apiKey: ApiKey }) {
  const tags: Array<{ label: string; color: string }> = [];

  if (apiKey.expiresAt) {
    const exp = new Date(apiKey.expiresAt);
    const now = new Date();
    const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
    const isNearExpiry = daysLeft <= 7 && daysLeft > 0;
    const isExpired = daysLeft <= 0;
    const dateStr = exp.toLocaleDateString();
    if (isExpired) {
      tags.push({ label: '\u5df2\u8fc7\u671f', color: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-400 dark:ring-red-800' });
    } else if (isNearExpiry) {
      tags.push({ label: `${daysLeft}\u5929\u540e\u8fc7\u671f`, color: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-800' });
    } else {
      tags.push({ label: `\u6709\u6548\u671f\u81f3 ${dateStr}`, color: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-800' });
    }
  }

  if (apiKey.rateLimitMax != null) {
    const windowSec = (apiKey.rateLimitWindowMs ?? 60000) / 1000;
    const unit = windowSec >= 60 ? `${windowSec / 60}min` : `${windowSec}s`;
    tags.push({ label: `${apiKey.rateLimitMax} req/${unit}`, color: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:ring-purple-800' });
  }

  if (apiKey.monthlyQuota != null) {
    const usage = apiKey.monthlyUsage ?? 0;
    tags.push({ label: `${usage.toLocaleString()} / ${apiKey.monthlyQuota.toLocaleString()} \u6b21/\u6708`, color: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950 dark:text-cyan-400 dark:ring-cyan-800' });
  }

  if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
    tags.push({ label: `${apiKey.ipWhitelist.length} \u4e2a IP`, color: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-400 dark:ring-green-800' });
  }

  if (tags.length === 0) {
    return <span className="rounded px-2 py-0.5 text-xs text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-700 ring-1 ring-gray-200 dark:ring-slate-600">\u65e0\u989d\u5916\u9650\u5236</span>;
  }

  return (
    <>
      {tags.map((tag, i) => (
        <span key={i} className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${tag.color}`}>
          {tag.label}
        </span>
      ))}
    </>
  );
}
