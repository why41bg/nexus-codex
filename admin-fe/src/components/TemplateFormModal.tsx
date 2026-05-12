import { useState } from 'react';
import type { ApiKeyTemplate } from '@/types';
import { formatDuration, WINDOW_PRESETS, generateRandomCode } from '@/lib/time';
import { inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useSaveApiKeyTemplate } from '@/hooks/useAdminMutations';
import BaseModal from './BaseModal';
import Spinner from './Spinner';

const defaultForm = {
  name: '',
  description: '',
  enabled: true,
  models: [] as string[],
  requireClaimCode: true,
  claimCode: '',
  claimCodeMaxUsage: '',
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
    claimCodeMaxUsage: template.claimCodeMaxUsage != null ? String(template.claimCodeMaxUsage) : '',
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
    claimCodeMaxUsage: form.claimCodeMaxUsage ? Number(form.claimCodeMaxUsage) : null,
    rateLimitMax: form.rateLimitMax ? Number(form.rateLimitMax) : null,
    rateLimitWindowMs: form.rateLimitWindowMs ? Number(form.rateLimitWindowMs) : null,
    monthlyQuota: form.monthlyQuota ? Number(form.monthlyQuota) : null,
    claimIpLimitMax: Number(form.claimIpLimitMax || 1),
    claimIpLimitWindowMs: Number(form.claimIpLimitWindowMs || 86400000),
  };
}

interface TemplateFormModalProps {
  editing: ApiKeyTemplate | null;
  models: string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function TemplateFormModal({ editing, models, onClose, onSaved }: TemplateFormModalProps) {
  const saveTemplateMutation = useSaveApiKeyTemplate();
  const [form, setForm] = useState<TemplateForm>(editing ? toForm(editing) : defaultForm);

  const toggleModel = (model: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.includes(model)
        ? prev.models.filter((item) => item !== model)
        : [...prev.models, model],
    }));
  };

  const saveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    saveTemplateMutation.mutate(
      { id: editing?.id, body: toPayload(form) },
      {
        onSuccess: () => {
          onSaved();
          onClose();
        },
      },
    );
  };

  return (
    <BaseModal title={editing ? '编辑申领模板' : '创建申领模板'} onClose={onClose}>
        <form onSubmit={saveTemplate} className="space-y-4">
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
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申领码</label>
                <div className="flex gap-2">
                  <input value={form.claimCode} onChange={(e) => setForm({ ...form, claimCode: e.target.value })} className={`flex-1 ${inputClass}`} placeholder="用户需要输入此码才能申领" />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, claimCode: generateRandomCode() })}
                    className="rounded-lg bg-gray-100 dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600 whitespace-nowrap"
                    title="生成随机申领码"
                  >
                    随机生成
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申领码使用次数上限</label>
                <div className="flex items-center gap-1">
                  <input type="number" min="1" value={form.claimCodeMaxUsage} onChange={(e) => setForm({ ...form, claimCodeMaxUsage: e.target.value })} placeholder="不限制" className={inputClass} />
                  <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">次</span>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-slate-500">留空表示不限制使用次数</p>
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
            <button type="submit" disabled={saveTemplateMutation.isPending} className={primaryBtnClass}>
              {saveTemplateMutation.isPending && <Spinner className="mr-1.5 h-4 w-4" />}
              {editing ? '保存' : '创建'}
            </button>
          </div>
        </form>
    </BaseModal>
  );
}
