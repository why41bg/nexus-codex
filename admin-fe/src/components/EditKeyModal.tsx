import { useState, useEffect, useRef } from 'react';
import type { ApiKey } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import { CloseIcon } from './icons';
import Spinner from './Spinner';
import { useFocusTrap } from '../lib/use-focus-trap';

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
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [name, setName] = useState(target.name || '');
  const [selectedModels, setSelectedModels] = useState<string[]>([...target.models]);
  const [customModel, setCustomModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [expiresAt, setExpiresAt] = useState(target.expiresAt ?? '');
  const [rateLimitMax, setRateLimitMax] = useState(target.rateLimitMax != null ? String(target.rateLimitMax) : '');
  const [rateLimitWindowMs, setRateLimitWindowMs] = useState(target.rateLimitWindowMs != null ? String(target.rateLimitWindowMs) : '');
  const [monthlyQuota, setMonthlyQuota] = useState(target.monthlyQuota != null ? String(target.monthlyQuota) : '');
  const [ipWhitelist, setIpWhitelist] = useState((target.ipWhitelist ?? []).join('\n'));

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = 'edit-key-modal-title';
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
      const ips = ipWhitelist.split('\n').map((s) => s.trim()).filter(Boolean);
      const res = await api('PATCH', `/api/admin/keys/${encodeURIComponent(target.keyPrefix)}`, {
        name,
        models: selectedModels,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        rateLimitMax: rateLimitMax ? Number(rateLimitMax) : null,
        rateLimitWindowMs: rateLimitWindowMs ? Number(rateLimitWindowMs) : null,
        monthlyQuota: monthlyQuota ? Number(monthlyQuota) : null,
        ipWhitelist: ips,
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('API Key \u5df2\u66f4\u65b0', 'success');
        onSaved();
        onClose();
      } else {
        toast(extractErrorMessage(res.data, '\u66f4\u65b0\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="mx-4 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none"
      >
        <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">\u7f16\u8f91 API Key</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Key: <span className="font-mono">{target.keyMasked}</span>
        </p>

        {/* Name */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u540d\u79f0/\u5907\u6ce8</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="\u4f8b\u5982 my-app"
            className={inputClass}
          />
        </div>

        {/* Model selection */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u53ef\u7528\u6a21\u578b</label>
          <p className="mb-2 text-xs text-gray-400 dark:text-slate-500">\u4e0d\u52fe\u9009\u4efb\u4f55\u6a21\u578b\u8868\u793a\u7ee7\u627f\u5168\u5c40\u9ed8\u8ba4\u5217\u8868</p>
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
              <span className="text-xs text-gray-400 dark:text-slate-500">\u6682\u65e0\u5168\u5c40\u6a21\u578b\u53ef\u9009</span>
            )}
          </div>

          {/* Custom model input */}
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              placeholder="\u6dfb\u52a0\u81ea\u5b9a\u4e49\u6a21\u578b..."
              className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 shadow-sm placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              onClick={addCustom}
              disabled={!customModel.trim()}
              className="rounded-lg bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-50"
            >
              \u6dfb\u52a0
            </button>
          </div>

          {/* Selected models preview */}
          {selectedModels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedModels.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800"
                >
                  {m}
                  <button onClick={() => toggleModel(m)} className="text-brand-400 hover:text-brand-600 dark:hover:text-brand-200">
                    <CloseIcon size="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-gray-400 dark:text-slate-500">\u672a\u9009\u62e9\u6a21\u578b \u2014 \u5c06\u7ee7\u627f\u5168\u5c40\u9ed8\u8ba4\u5217\u8868</div>
          )}
        </div>

        {/* Advanced config */}
        <div className="mt-4 border border-gray-200 dark:border-slate-700 rounded-lg">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors rounded-lg"
          >
            <span>\u9ad8\u7ea7\u914d\u7f6e</span>
            <span className="text-gray-400 dark:text-slate-500">{showAdvanced ? '\u25b2' : '\u25bc'}</span>
          </button>
          {showAdvanced && (
            <div className="border-t border-gray-200 dark:border-slate-700 px-4 py-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u6709\u6548\u671f</label>
                <input
                  type="datetime-local"
                  value={expiresAt ? new Date(expiresAt).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setExpiresAt(e.target.value || '')}
                  className={inputClass}
                />
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">\u7559\u7a7a\u8868\u793a\u6c38\u4e0d\u8fc7\u671f</p>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u6700\u5927\u8bf7\u6c42\u6570</label>
                  <input
                    type="number"
                    min="1"
                    value={rateLimitMax}
                    onChange={(e) => setRateLimitMax(e.target.value)}
                    placeholder="\u7ee7\u627f\u5168\u5c40"
                    className={inputClass}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u7a97\u53e3\u65f6\u957f (ms)</label>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={rateLimitWindowMs}
                    onChange={(e) => setRateLimitWindowMs(e.target.value)}
                    placeholder="\u7ee7\u627f\u5168\u5c40"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u6708\u8c03\u7528\u914d\u989d</label>
                <input
                  type="number"
                  min="1"
                  value={monthlyQuota}
                  onChange={(e) => setMonthlyQuota(e.target.value)}
                  placeholder="\u4e0d\u9650\u5236"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">IP \u767d\u540d\u5355</label>
                <textarea
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  placeholder={"\u6bcf\u884c\u4e00\u4e2a IP \u5730\u5740\n\u4f8b\u5982: 192.168.1.100"}
                  rows={3}
                  className={inputClass + ' font-mono text-xs'}
                />
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">\u7559\u7a7a\u8868\u793a\u4e0d\u9650\u5236 IP</p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className={secondaryBtnClass}>
            \u53d6\u6d88
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {saving && <Spinner className="mr-1.5 inline h-4 w-4" />}
            \u4fdd\u5b58
          </button>
        </div>
      </div>
    </div>
  );
}
