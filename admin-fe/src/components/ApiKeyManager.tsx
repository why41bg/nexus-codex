import { useState } from 'react';
import type { ApiKey } from '@/types';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import Spinner from './Spinner';

/* ── Icons ─────────────────────────────────────────────────── */

function EyeIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeSlashIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
    </svg>
  );
}

function CloseIcon({ size = 'h-3.5 w-3.5' }: { size?: string }) {
  return (
    <svg className={size} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/* ── Clipboard helper ──────────────────────────────────────── */

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

/* ── Edit Key Modal ────────────────────────────────────────── */

function EditKeyModal({
  target,
  globalModels,
  onClose,
  onSaved,
}: {
  target: ApiKey;
  globalModels: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [name, setName] = useState(target.name || '');
  const [selectedModels, setSelectedModels] = useState<string[]>([...target.models]);
  const [customModel, setCustomModel] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleModel = (m: string) => {
    setSelectedModels((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  };

  const addCustom = () => {
    const m = customModel.trim();
    if (!m) return;
    if (!selectedModels.includes(m)) {
      setSelectedModels((prev) => [...prev, m]);
    }
    setCustomModel('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api('PATCH', `/api/admin/keys/${encodeURIComponent(target.key)}`, {
        name,
        models: selectedModels,
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('API Key 已更新', 'success');
        onSaved();
        onClose();
      } else {
        const d = res.data as { error?: { message?: string } };
        toast(d?.error?.message || '更新失败', 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-gray-200">
        <h3 className="text-base font-semibold text-gray-900">编辑 API Key</h3>
        <p className="mt-1 text-xs text-gray-500">
          Key: <span className="font-mono">{target.keyMasked}</span>
        </p>

        {/* Name */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">名称/备注</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 my-app"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {/* Model selection */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">可用模型</label>
          <p className="mb-2 text-xs text-gray-400">不勾选任何模型表示继承全局默认列表</p>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 p-3">
            {globalModels.map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedModels.includes(m)}
                  onChange={() => toggleModel(m)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-gray-700">{m}</span>
              </label>
            ))}
            {globalModels.length === 0 && (
              <span className="text-xs text-gray-400">暂无全局模型可选</span>
            )}
          </div>

          {/* Custom model input */}
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              placeholder="添加自定义模型..."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              onClick={addCustom}
              disabled={!customModel.trim()}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              添加
            </button>
          </div>

          {/* Selected models preview */}
          {selectedModels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedModels.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200"
                >
                  {m}
                  <button onClick={() => toggleModel(m)} className="text-brand-400 hover:text-brand-600">
                    <CloseIcon size="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-gray-400">未选择模型 — 将继承全局默认列表</div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {saving && <Spinner className="mr-1.5 inline h-4 w-4" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main ApiKeyManager ────────────────────────────────────── */

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

  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopy = async (key: string) => {
    await copyToClipboard(key);
    toast('已复制到剪贴板', 'success');
  };

  const addKey = async () => {
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
        const d = res.data as unknown as { error?: { message?: string } };
        toast(d?.error?.message || '生成失败', 'error');
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
      const res = await api('DELETE', `/api/admin/keys/${encodeURIComponent(deleteTarget.key)}`);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('API Key 已删除', 'success');
        setDeleteTarget(null);
        onRefresh();
      } else {
        const d = res.data as { error?: { message?: string } };
        toast(d?.error?.message || '删除失败', 'error');
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
                <tr key={k.key} className="transition-colors hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-700">{k.name || '\u2014'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-gray-600">
                        {revealedKeys[k.key] ? k.key : k.keyMasked}
                      </span>
                      <button
                        onClick={() => toggleReveal(k.key)}
                        className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        title={revealedKeys[k.key] ? '隐藏' : '显示'}
                      >
                        {revealedKeys[k.key] ? <EyeSlashIcon /> : <EyeIcon />}
                      </button>
                      <button
                        onClick={() => handleCopy(k.key)}
                        className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        title="复制"
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
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 sm:max-w-xs">
            <label className="mb-1 block text-xs font-medium text-gray-600">名称/备注</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKey()}
              placeholder="例如 my-app"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <button
            onClick={addKey}
            disabled={addingKey}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50"
          >
            {addingKey && <Spinner className="mr-1.5 h-4 w-4" />}
            生成
          </button>
        </div>

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
