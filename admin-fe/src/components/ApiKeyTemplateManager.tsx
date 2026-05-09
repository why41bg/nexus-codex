import { useState } from 'react';
import type { ApiKeyTemplate } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useAuthGuard } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import ConfirmModal from './ConfirmModal';
import Spinner from './Spinner';

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

export default function ApiKeyTemplateManager({ templates, models, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [form, setForm] = useState<TemplateForm>(defaultForm);
  const [editing, setEditing] = useState<ApiKeyTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const resetForm = () => {
    setForm(defaultForm);
    setEditing(null);
  };

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
        resetForm();
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '保存失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setSaving(false);
    }
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
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">自助申领模板</h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        用户在门户申领 API Key 时，系统会复制模板中的模型、额度、限流和申领码策略。
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {loading && templates.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-5 w-5 text-brand-600" />
              <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
            </div>
          )}
          {!loading && templates.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
              暂无申领模板
            </div>
          )}
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
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
                      IP 申领 {template.claimIpLimitMax} 次 / {Math.round(template.claimIpLimitWindowMs / 60000)} 分钟
                    </span>
                    {template.monthlyQuota != null && (
                      <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                        月额度 {template.monthlyQuota}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(template); setForm(toForm(template)); }}
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

        <form onSubmit={saveTemplate} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-300">
            {editing ? '编辑模板' : '创建模板'}
          </h4>
          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">模板名称</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">说明</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              启用模板
            </label>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">可用模型</label>
              <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-slate-700">
                {models.map((model) => (
                  <label key={model} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50 dark:hover:bg-slate-700">
                    <input type="checkbox" checked={form.models.includes(model)} onChange={() => toggleModel(model)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                    <span className="text-sm text-gray-700 dark:text-slate-300">{model}</span>
                  </label>
                ))}
                {models.length === 0 && <span className="text-xs text-gray-400 dark:text-slate-500">暂无全局模型可选</span>}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={form.requireClaimCode} onChange={(e) => setForm({ ...form, requireClaimCode: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              需要申领码
            </label>
            {form.requireClaimCode && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申领码</label>
                <input value={form.claimCode} onChange={(e) => setForm({ ...form, claimCode: e.target.value })} className={inputClass} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">IP 次数</label>
                <input type="number" min="1" value={form.claimIpLimitMax} onChange={(e) => setForm({ ...form, claimIpLimitMax: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">窗口 ms</label>
                <input type="number" min="60000" step="60000" value={form.claimIpLimitWindowMs} onChange={(e) => setForm({ ...form, claimIpLimitWindowMs: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">Key 请求数</label>
                <input type="number" min="1" value={form.rateLimitMax} onChange={(e) => setForm({ ...form, rateLimitMax: e.target.value })} placeholder="不设置" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">窗口 ms</label>
                <input type="number" min="1000" step="1000" value={form.rateLimitWindowMs} onChange={(e) => setForm({ ...form, rateLimitWindowMs: e.target.value })} placeholder="不设置" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">月调用配额</label>
              <input type="number" min="1" value={form.monthlyQuota} onChange={(e) => setForm({ ...form, monthlyQuota: e.target.value })} placeholder="不限制" className={inputClass} />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className={primaryBtnClass}>
                {saving && <Spinner className="mr-1.5 h-4 w-4" />}
                {editing ? '保存' : '创建'}
              </button>
              {editing && (
                <button type="button" onClick={resetForm} className={secondaryBtnClass}>取消</button>
              )}
            </div>
          </div>
        </form>
      </div>

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
