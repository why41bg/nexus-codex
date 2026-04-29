import { useState, useEffect, useRef } from 'react';
import type { ApiKey } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass } from '@/lib/styles';
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = 'edit-key-modal-title';
  useFocusTrap(dialogRef);

  // Escape 键关闭 + 焦点管理
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
      const res = await api('PATCH', `/api/admin/keys/${encodeURIComponent(target.keyPrefix)}`, {
        name,
        models: selectedModels,
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('API Key 已更新', 'success');
        onSaved();
        onClose();
      } else {
        toast(extractErrorMessage(res.data, '更新失败'), 'error');
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
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-gray-200 outline-none"
      >
        <h3 id={titleId} className="text-base font-semibold text-gray-900">编辑 API Key</h3>
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
            className={inputClass}
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
