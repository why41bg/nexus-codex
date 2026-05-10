import { useState, useEffect, useRef } from 'react';
import type { ApiKeyTemplate } from '@/types';
import { api, API_BASE, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useAuthGuard } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { CopyIcon, CloseIcon } from './icons';
import ConfirmModal from './ConfirmModal';
import Spinner from './Spinner';
import { useFocusTrap } from '../lib/use-focus-trap';

interface Props {
  templates: ApiKeyTemplate[];
  models: string[];
  loading: boolean;
  onRefresh: () => void;
}

const defaultForm = {
  name: '',
  description: '',
  enabled: true,
  models: [] as string[],
  requireClaimCode: true,
  claimCode: '',
  rateLimitMax: '',
  rateLimitWindowMs: '',
  monthlyQuota: '',
  claimIpLimitMax: '1',
  claimIpLimitWindowMs: '86400000',
};

type TemplateForm = typeof defaultForm;

/** 将毫秒转换为友好的时间显示 */
function formatDuration(ms: number): string {
  if (ms >= 86400000) {
    const days = ms / 86400000;
    return days === 1 ? '1 天' : `${days} 天`;
  }
  if (ms >= 3600000) {
    const hours = ms / 3600000;
    return hours === 1 ? '1 小时' : `${hours} 小时`;
  }
  const minutes = ms / 60000;
  return minutes === 1 ? '1 分钟' : `${minutes} 分钟`;
}

/** 预设的时间窗口选项 */
const WINDOW_PRESETS = [
  { label: '1 小时', value: '3600000' },
  { label: '6 小时', value: '21600000' },
  { label: '12 小时', value: '43200000' },
  { label: '24 小时', value: '86400000' },
  { label: '7 天', value: '604800000' },
];

/** 生成随机申领码 */
function generateClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function toForm(template: ApiKeyTemplate): TemplateForm {
  return {
    name: template.name,
    description: template.description,
    enabled: template.enabled,
    models: [...template.models],
    requireClaimCode: template.requireClaimCode,
    claimCode: template.claimCode || '',
    rateLimitMax: template.rateLimitMax != null ? String(template.rateLimitMax) : '',
    rateLimitWindowMs: template.rateLimitWindowMs != null ? String(template.rateLimitWindowMs) : '',
    monthlyQuota: template.monthlyQuota != null ? String(template.monthlyQuota) : '',
    claimIpLimitMax: String(template.claimIpLimitMax),
    claimIpLimitWindowMs: String(template.claimIpLimitWindowMs),
  };
}

function toPayload(form: TemplateForm) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    enabled: form.enabled,
    models: form.models,
    requireClaimCode: form.requireClaimCode,
    claimCode: form.claimCode.trim(),
    rateLimitMax: form.rateLimitMax ? Number(form.rateLimitMax) : null,
    rateLimitWindowMs: form.rateLimitWindowMs ? Number(form.rateLimitWindowMs) : null,
    monthlyQuota: form.monthlyQuota ? Number(form.monthlyQuota) : null,
    claimIpLimitMax: Number(form.claimIpLimitMax || 1),
    claimIpLimitWindowMs: Number(form.claimIpLimitWindowMs || 86400000),
  };
}

// ─── Template Form Modal ────────────────────────────────────────

interface TemplateFormModalProps {
  editing: ApiKeyTemplate | null;
  models: string[];
  onClose: () => void;
  onSaved: () => void;
}

function TemplateFormModal({ editing, models, onClose, onSaved }: TemplateFormModalProps) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [form, setForm] = useState<TemplateForm>(editing ? toForm(editing) : defaultForm);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = 'template-form-modal-title';
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const toggleModel = (model: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.includes(model)
        ? prev.models.filter((item) => item !== model)
        : [...prev.models, model],
    }));
  };

  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const path = editing
        ? `/api/admin/key-templates/${encodeURIComponent(editing.id)}`
        : '/api/admin/key-templates';
      const method = editing ? 'PATCH' : 'POST';
      const res = await api<{ template: ApiKeyTemplate }>(method, path, toPayload(form));
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast(editing ? '申领模板已更新' : '申领模板已创建', 'success');
        onSaved();
        onClose();
      } else {
        toast(extractErrorMessage(res.data, '保存失败'), 'error');
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
        className="mx-4 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none"
      >
        <div className="flex items-center justify-between">
          <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">
            {editing ? '编辑申领模板' : '创建申领模板'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={saveTemplate} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">模板名称</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="例如: 团队开发者通用" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">说明</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputClass} placeholder="面向申领用户的模板说明" />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            启用模板
          </label>

          {/* 可用模型 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">可用模型</label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-slate-700">
              {models.map((model) => (
                <label key={model} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50 dark:hover:bg-slate-700">
                  <input type="checkbox" checked={form.models.includes(model)} onChange={() => toggleModel(model)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-sm text-gray-700 dark:text-slate-300">{model}</span>
                </label>
              ))}
              {models.length === 0 && <span className="text-xs text-gray-400 dark:text-slate-500">暂无全局模型可选</span>}
            </div>
          </div>

          {/* 申领码设置 */}
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={form.requireClaimCode} onChange={(e) => setForm({ ...form, requireClaimCode: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            需要申领码
          </label>
          {form.requireClaimCode && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申领码</label>
              <div className="flex gap-2">
                <input value={form.claimCode} onChange={(e) => setForm({ ...form, claimCode: e.target.value })} className={`flex-1 ${inputClass}`} placeholder="用户需要输入此码才能申领" />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, claimCode: generateClaimCode() })}
                  className="rounded-lg bg-gray-100 dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600 whitespace-nowrap"
                  title="生成随机申领码"
                >
                  随机生成
                </button>
              </div>
            </div>
          )}

          {/* IP 申领限制 */}
          <fieldset className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600 dark:text-slate-400">IP 申领频率限制</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">同 IP 最多申领</label>
                <div className="flex items-center gap-1">
                  <input type="number" min="1" value={form.claimIpLimitMax} onChange={(e) => setForm({ ...form, claimIpLimitMax: e.target.value })} className={inputClass} />
                  <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">次</span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">时间窗口</label>
                <select
                  value={WINDOW_PRESETS.some((p) => p.value === form.claimIpLimitWindowMs) ? form.claimIpLimitWindowMs : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setForm({ ...form, claimIpLimitWindowMs: e.target.value });
                    }
                  }}
                  className={inputClass}
                >
                  {WINDOW_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                  {!WINDOW_PRESETS.some((p) => p.value === form.claimIpLimitWindowMs) && (
                    <option value="custom">自定义 ({formatDuration(Number(form.claimIpLimitWindowMs))})</option>
                  )}
                </select>
              </div>
            </div>
          </fieldset>

          {/* Key 限流配置 */}
          <fieldset className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600 dark:text-slate-400">Key 调用限制</legend>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">请求上限</label>
                  <div className="flex items-center gap-1">
                    <input type="number" min="1" value={form.rateLimitMax} onChange={(e) => setForm({ ...form, rateLimitMax: e.target.value })} placeholder="不限制" className={inputClass} />
                    <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">次</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">每</label>
                  <select
                    value={
                      !form.rateLimitWindowMs ? '' :
                      WINDOW_PRESETS.some((p) => p.value === form.rateLimitWindowMs) ? form.rateLimitWindowMs : 'custom'
                    }
                    onChange={(e) => {
                      if (e.target.value !== 'custom') {
                        setForm({ ...form, rateLimitWindowMs: e.target.value });
                      }
                    }}
                    className={inputClass}
                  >
                    <option value="">不限制</option>
                    <option value="60000">1 分钟</option>
                    <option value="300000">5 分钟</option>
                    <option value="3600000">1 小时</option>
                    <option value="86400000">24 小时</option>
                    {form.rateLimitWindowMs && !['', '60000', '300000', '3600000', '86400000'].includes(form.rateLimitWindowMs) && (
                      <option value="custom">自定义 ({formatDuration(Number(form.rateLimitWindowMs))})</option>
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">月调用配额</label>
                <div className="flex items-center gap-1">
                  <input type="number" min="1" value={form.monthlyQuota} onChange={(e) => setForm({ ...form, monthlyQuota: e.target.value })} placeholder="不限制" className={inputClass} />
                  <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">次/月</span>
                </div>
              </div>
            </div>
          </fieldset>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryBtnClass}>取消</button>
            <button type="submit" disabled={saving} className={primaryBtnClass}>
              {saving && <Spinner className="mr-1.5 h-4 w-4" />}
              {editing ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function ApiKeyTemplateManager({ templates, models, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ApiKeyTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = () => {
    setEditingTemplate(null);
    setShowFormModal(true);
  };

  const openEdit = (template: ApiKeyTemplate) => {
    setEditingTemplate(template);
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingTemplate(null);
  };

  const copyClaimLink = async (template: ApiKeyTemplate) => {
    const base = window.location.origin || API_BASE;
    const url = `${base}/claim?template=${encodeURIComponent(template.id)}`;
    await copyToClipboard(url);
    toast('申领链接已复制', 'success');
  };

  const copyClaimCodeFn = async (code: string) => {
    await copyToClipboard(code);
    toast('申领码已复制', 'success');
  };

  const deleteTemplate = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api('DELETE', `/api/admin/key-templates/${encodeURIComponent(deleteTarget.id)}`);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('申领模板已删除', 'success');
        setDeleteTarget(null);
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '删除失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`mt-6 ${cardClass} p-6`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">自助申领模板</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            用户在门户申领 API Key 时，系统会复制模板中的模型、额度、限流和申领码策略。
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className={primaryBtnClass}
        >
          创建模板
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {loading && templates.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-5 w-5 text-brand-600" />
            <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
          </div>
        )}
        {!loading && templates.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
            暂无申领模板，点击上方按钮创建
          </div>
        )}
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{template.name}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${template.enabled ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {template.enabled ? '已启用' : '已停用'}
                  </span>
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                    {template.requireClaimCode ? '需要申领码' : '无需申领码'}
                  </span>
                </div>
                {template.description && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{template.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {template.models.map((model) => (
                    <span key={model} className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800">
                      {model}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs text-gray-500 dark:text-slate-400">
                  <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                    同 IP 限 {template.claimIpLimitMax} 次 / {formatDuration(template.claimIpLimitWindowMs)}
                  </span>
                  {template.rateLimitMax != null && (
                    <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                      限速 {template.rateLimitMax} 次 / {formatDuration(template.rateLimitWindowMs ?? 60000)}
                    </span>
                  )}
                  {template.monthlyQuota != null && (
                    <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                      月额度 {template.monthlyQuota.toLocaleString()}
                    </span>
                  )}
                </div>
                {/* 申领码快捷展示 */}
                {template.requireClaimCode && template.claimCode && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-xs text-gray-400 dark:text-slate-500">申领码:</span>
                    <code className="rounded bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:text-slate-300">
                      {template.claimCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyClaimCodeFn(template.claimCode!)}
                      className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                      title="复制申领码"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyClaimLink(template)}
                  className="rounded-md bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                  title="复制申领链接"
                >
                  <span className="inline-flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                    链接
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(template)}
                  className="rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(template)}
                  className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      {showFormModal && (
        <TemplateFormModal
          editing={editingTemplate}
          models={models}
          onClose={closeFormModal}
          onSaved={onRefresh}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmModal
          title="确认删除申领模板"
          confirmLabel="删除"
          loading={deleting}
          onConfirm={deleteTemplate}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>确定要删除申领模板 <span className="font-semibold">{deleteTarget.name}</span> 吗？已有 API Key 不会被删除。</p>
        </ConfirmModal>
      )}
    </div>
  );
}
