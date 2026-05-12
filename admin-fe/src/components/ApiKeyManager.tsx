import { useState, useMemo } from 'react';
import type { ApiKey } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { inputClass, primaryBtnClass, cardClass } from '@/lib/styles';
import { relativeTime } from '@/lib/time';
import { useToast } from '@/contexts/ToastContext';
import { CopyIcon } from './icons';
import { SelfServiceBadge, KeyApplicantInfo } from './KeyApplicantInfo';
import EditKeyModal from './EditKeyModal';
import ConfirmModal from './ConfirmModal';
import PasswordConfirmModal from './PasswordConfirmModal';
import Spinner from './Spinner';

type SourceFilter = 'all' | 'admin' | 'self_service';

interface Props {
  apiKeys: ApiKey[];
  models: string[];
  loading: boolean;
  onRefresh: () => void;
}

export default function ApiKeyManager({ apiKeys, models, loading, onRefresh }: Props) {
  const { toast } = useToast();

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [newKeyName, setNewKeyName] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [lastCreatedKey, setLastCreatedKey] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  // Batch selection
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  // Reveal key with password
  const [revealTarget, setRevealTarget] = useState<ApiKey | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    toast('已复制到剪贴板', 'success');
  };

  const handleRevealAndCopy = async (password: string) => {
    if (!revealTarget) return;
    setRevealLoading(true);
    setRevealError(null);
    try {
      const res = await api<{ key: string }>('POST', '/api/admin/keys/reveal', {
        keyPrefix: revealTarget.keyPrefix,
        password,
      });
      if (res.ok && res.data?.key) {
        await copyToClipboard(res.data.key);
        toast('完整 Key 已复制到剪贴板', 'success');
        setRevealTarget(null);
      } else {
        setRevealError(extractErrorMessage(res.data, '验证失败'));
      }
    } catch {
      setRevealError('请求失败');
    } finally {
      setRevealLoading(false);
    }
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
      if (res.ok && res.data?.key) {
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

  const toggleKeyEnabled = async (k: ApiKey) => {
    const newEnabled = !(k.enabled ?? true);
    try {
      const res = await api('PATCH', `/api/admin/keys/${encodeURIComponent(k.keyPrefix)}`, { enabled: newEnabled });
      if (res.ok) {
        toast(newEnabled ? '已启用' : '已禁用', 'success');
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '操作失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    }
  };

  const doBatchAction = async (action: 'delete' | 'enable' | 'disable') => {
    if (selectedKeys.size === 0) return;
    setBatchLoading(true);
    try {
      const res = await api<{ succeeded: number; failed: number }>('POST', '/api/admin/keys/batch', {
        keyPrefixes: Array.from(selectedKeys),
        action,
      });
      if (res.ok && res.data) {
        toast(`操作完成：成功 ${res.data.succeeded ?? 0}，失败 ${res.data.failed ?? 0}`, 'success');
        setSelectedKeys(new Set());
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '批量操作失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setBatchLoading(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedKeys.size === filteredKeys.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredKeys.map((k) => k.keyPrefix)));
    }
  };

  const toggleSelect = (prefix: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const filteredKeys = useMemo(() => {
    if (sourceFilter === 'all') return apiKeys;
    return apiKeys.filter((k) => {
      if (sourceFilter === 'self_service') return k.source === 'self_service';
      return k.source !== 'self_service';
    });
  }, [apiKeys, sourceFilter]);

  const selfServiceCount = useMemo(() => apiKeys.filter((k) => k.source === 'self_service').length, [apiKeys]);
  const adminCount = useMemo(() => apiKeys.filter((k) => k.source !== 'self_service').length, [apiKeys]);

  return (
    <div className={`mt-8 ${cardClass} p-6`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">API Key 管理</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        管理 API Key 访问权限。每个 Key 可独立配置允许使用的模型列表，未配置时继承全局默认模型。
      </p>

      {/* Source Filter Tabs */}
      {apiKeys.length > 0 && (
        <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 dark:bg-slate-800 p-1 w-fit">
          <button
            type="button"
            onClick={() => setSourceFilter('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              sourceFilter === 'all'
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            全部 ({apiKeys.length})
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('admin')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              sourceFilter === 'admin'
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            管理员创建 ({adminCount})
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('self_service')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              sourceFilter === 'self_service'
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            自助申领 ({selfServiceCount})
          </button>
        </div>
      )}

      {/* Key List */}
      {loading && apiKeys.length === 0 && (
        <div className="mt-4 flex items-center justify-center py-10">
          <Spinner className="h-5 w-5 text-brand-600" />
          <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
        </div>
      )}

      {!loading && apiKeys.length === 0 && (
        <div className="mt-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
          暂无 API Key，请添加至少一个 Key 以启用鉴权
        </div>
      )}

      {!loading && apiKeys.length > 0 && filteredKeys.length === 0 && (
        <div className="mt-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
          当前筛选条件下没有 API Key
        </div>
      )}

      {/* Batch Actions Bar */}
      {selectedKeys.size > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-brand-50 dark:bg-brand-950 px-4 py-2.5 ring-1 ring-brand-200 dark:ring-brand-800">
          <span className="text-sm font-medium text-brand-700 dark:text-brand-300">已选 {selectedKeys.size} 项</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => doBatchAction('enable')} disabled={batchLoading} className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">批量启用</button>
            <button onClick={() => doBatchAction('disable')} disabled={batchLoading} className="rounded-md bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-50">批量禁用</button>
            <button onClick={() => doBatchAction('delete')} disabled={batchLoading} className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">批量删除</button>
          </div>
        </div>
      )}

      {filteredKeys.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className={`mt-4 hidden overflow-hidden ${cardClass} md:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/60">
                <tr>
                  <th className="px-2 py-3 w-8">
                    <input type="checkbox" checked={selectedKeys.size === filteredKeys.length && filteredKeys.length > 0} onChange={toggleSelectAll} className="rounded border-gray-300 dark:border-slate-600" />
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">名称</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">状态</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Key</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">可用模型</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">限制</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">创建时间</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {filteredKeys.map((k) => (
                  <tr key={k.keyPrefix} className={`transition-colors hover:bg-gray-50/50 dark:hover:bg-slate-700/50 ${(k.enabled === false) ? 'opacity-50' : ''}`}>
                    <td className="px-2 py-3">
                      <input type="checkbox" checked={selectedKeys.has(k.keyPrefix)} onChange={() => toggleSelect(k.keyPrefix)} className="rounded border-gray-300 dark:border-slate-600" />
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                      <div className="flex items-center gap-2">
                        <span>{k.name || '—'}</span>
                        {k.source === 'self_service' && <SelfServiceBadge />}
                      </div>
                      <KeyApplicantInfo apiKey={k} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleKeyEnabled(k)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(k.enabled ?? true) ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-600'}`}
                        title={(k.enabled ?? true) ? '点击禁用' : '点击启用'}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${(k.enabled ?? true) ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-600 dark:text-slate-400">{k.keyMasked}</span>
                        <button
                          onClick={() => { setRevealError(null); setRevealTarget(k); }}
                          className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                          title="复制完整 Key（需验证密码）"
                        >
                          <CopyIcon />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {k.models.length === 0 ? (
                          <span className="rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs text-gray-500 dark:text-slate-400">继承全局默认</span>
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
                          编辑
                        </button>
                        <button
                          onClick={() => setDeleteTarget(k)}
                          className="rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
                        >
                          删除
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
            {filteredKeys.map((k) => (
              <div key={k.keyPrefix} className={`${cardClass} p-4`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{k.name || '—'}</span>
                      {k.source === 'self_service' && <SelfServiceBadge />}
                    </div>
                    <KeyApplicantInfo apiKey={k} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-400">{k.keyMasked}</span>
                    <button
                      onClick={() => { setRevealError(null); setRevealTarget(k); }}
                      className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                      title="复制完整 Key（需验证密码）"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {k.models.length === 0 ? (
                    <span className="rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs text-gray-500 dark:text-slate-400">继承全局默认</span>
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
                      编辑
                    </button>
                    <button
                      onClick={() => setDeleteTarget(k)}
                      className="rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
                    >
                      删除
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
        <h3 className="text-xs font-semibold text-gray-700 dark:text-slate-300">生成新 Key</h3>
        <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
          系统将自动生成 <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono">sk-</code> 前缀的安全随机 Key
        </p>
        <form onSubmit={addKey} className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 md:max-w-xs">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">名称/备注</label>
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

        {lastCreatedKey && (
          <div className="mt-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 p-3">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">
              Key 已生成，请立即复制保存（后续复制需验证管理员密码）：
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 rounded bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-sm text-green-900 dark:text-green-200 ring-1 ring-green-200 dark:ring-green-800">
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

      {revealTarget && (
        <PasswordConfirmModal
          title="复制完整 API Key"
          description={`验证管理员密码后将复制 ${revealTarget.keyMasked} 的完整内容到剪贴板。`}
          confirmLabel="验证并复制"
          loading={revealLoading}
          error={revealError}
          onConfirm={handleRevealAndCopy}
          onCancel={() => setRevealTarget(null)}
        />
      )}

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

// ─── 限制 Tag 子组件 ────────────────────────────────────────────

function KeyRestrictionTags({ apiKey }: { apiKey: ApiKey }) {
  const tags: Array<{ label: string; color: string }> = [];

  if (apiKey.expiresAt) {
    const expired = new Date(apiKey.expiresAt) <= new Date();
    if (expired) {
      tags.push({ label: '已过期', color: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-400 dark:ring-red-800' });
    } else {
      tags.push({ label: `${relativeTime(apiKey.expiresAt)} 过期`, color: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:ring-orange-800' });
    }
  }

  if (apiKey.rateLimitMax != null) {
    const windowSec = (apiKey.rateLimitWindowMs ?? 60000) / 1000;
    const unit = windowSec >= 60 ? `${windowSec / 60}min` : `${windowSec}s`;
    tags.push({ label: `${apiKey.rateLimitMax} req/${unit}`, color: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:ring-purple-800' });
  }

  if (apiKey.monthlyQuota != null) {
    const usage = apiKey.monthlyUsage ?? 0;
    tags.push({ label: `${usage.toLocaleString()} / ${apiKey.monthlyQuota.toLocaleString()} 次/月`, color: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950 dark:text-cyan-400 dark:ring-cyan-800' });
  }

  if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
    tags.push({ label: `${apiKey.ipWhitelist.length} 个 IP`, color: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-400 dark:ring-green-800' });
  }

  if (tags.length === 0) {
    return <span className="rounded px-2 py-0.5 text-xs text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-700 ring-1 ring-gray-200 dark:ring-slate-600">无额外限制</span>;
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
