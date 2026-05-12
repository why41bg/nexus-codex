import { useState } from 'react';
import type { ApiKey } from '@/types';
import { inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useUpdateApiKey } from '@/hooks/useAdminMutations';
import { CloseIcon } from './icons';
import Spinner from './Spinner';
import BaseModal from './BaseModal';

interface EditKeyModalProps {
  target: ApiKey;
  globalModels: string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function EditKeyModal({
  target,
  globalModels,
  onClose,
  onSaved,
}: EditKeyModalProps) {
  const updateKeyMutation = useUpdateApiKey();
  const [name, setName] = useState(target.name || '');
  const [selectedModels, setSelectedModels] = useState<string[]>([...target.models]);
  const [customModel, setCustomModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [expiresAt, setExpiresAt] = useState(target.expiresAt ? target.expiresAt.slice(0, 16) : '');
  const [rateLimitMax, setRateLimitMax] = useState(target.rateLimitMax != null ? String(target.rateLimitMax) : '');
  const [rateLimitWindowMs, setRateLimitWindowMs] = useState(target.rateLimitWindowMs != null ? String(target.rateLimitWindowMs) : '');
  const [monthlyQuota, setMonthlyQuota] = useState(target.monthlyQuota != null ? String(target.monthlyQuota) : '');
  const [ipWhitelist, setIpWhitelist] = useState((target.ipWhitelist ?? []).join('\n'));

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

  const save = () => {
    const ips = ipWhitelist.split('\n').map((s) => s.trim()).filter(Boolean);
    updateKeyMutation.mutate(
      {
        keyPrefix: target.keyPrefix,
        body: {
          name,
          models: selectedModels,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          rateLimitMax: rateLimitMax ? Number(rateLimitMax) : null,
          rateLimitWindowMs: rateLimitWindowMs ? Number(rateLimitWindowMs) : null,
          monthlyQuota: monthlyQuota ? Number(monthlyQuota) : null,
          ipWhitelist: ips,
        },
      },
      {
        onSuccess: () => {
          onSaved();
          onClose();
        },
      },
    );
  };

  return (
    <BaseModal
      title="编辑 API Key"
      description={`Key: ${target.keyMasked}`}
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">名称/备注</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 my-app"
          className={inputClass}
        />
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">可用模型</label>
        <p className="mb-2 text-xs text-gray-400 dark:text-slate-500">不勾选任何模型表示继承全局默认列表</p>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          {globalModels.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50 dark:hover:bg-slate-700">
              <input
                type="checkbox"
                checked={selectedModels.includes(m)}
                onChange={() => toggleModel(m)}
                className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-700 dark:text-slate-300">{m}</span>
            </label>
          ))}
          {globalModels.length === 0 && (
            <span className="text-xs text-gray-400 dark:text-slate-500">暂无全局模型可选</span>
          )}
        </div>

        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="添加自定义模型..."
            className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 shadow-sm placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!customModel.trim()}
            className="rounded-lg bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            添加
          </button>
        </div>

        {selectedModels.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {selectedModels.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1 rounded bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800"
              >
                {m}
                <button type="button" onClick={() => toggleModel(m)} className="text-brand-400 hover:text-brand-600 dark:hover:text-brand-200">
                  <CloseIcon size="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-xs text-gray-400 dark:text-slate-500">未选择模型 — 将继承全局默认列表</div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-xs font-semibold text-gray-700 dark:text-slate-300 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          <span>高级配置</span>
          <span className="text-gray-400 dark:text-slate-500">{showAdvanced ? '▲' : '▼'}</span>
        </button>
        {showAdvanced && (
          <div className="space-y-3 border-t border-gray-200 px-4 py-3 dark:border-slate-700">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">过期时间</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={inputClass}
              />
              <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">留空表示永不过期</p>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">最大请求数</label>
                <input
                  type="number"
                  min="1"
                  value={rateLimitMax}
                  onChange={(e) => setRateLimitMax(e.target.value)}
                  placeholder="继承全局"
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">窗口时长 (ms)</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={rateLimitWindowMs}
                  onChange={(e) => setRateLimitWindowMs(e.target.value)}
                  placeholder="继承全局"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">月调用配额</label>
              <input
                type="number"
                min="1"
                value={monthlyQuota}
                onChange={(e) => setMonthlyQuota(e.target.value)}
                placeholder="不限制"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">IP 白名单</label>
              <textarea
                value={ipWhitelist}
                onChange={(e) => setIpWhitelist(e.target.value)}
                placeholder={"每行一个 IP 地址\n例如: 192.168.1.100"}
                rows={3}
                className={inputClass + ' font-mono text-xs'}
              />
              <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">留空表示不限制 IP</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={secondaryBtnClass}>
          取消
        </button>
        <button type="button" onClick={save} disabled={updateKeyMutation.isPending} className={primaryBtnClass}>
          {updateKeyMutation.isPending && <Spinner className="mr-1.5 inline h-4 w-4" />}
          保存
        </button>
      </div>
    </BaseModal>
  );
}
