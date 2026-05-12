import type { ContributionInvite } from '@/types';
import { formatDuration, WINDOW_PRESETS, generateRandomCode } from '@/lib/time';
import { inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import BaseModal from './BaseModal';
import Spinner from './Spinner';

export interface InviteFormState {
  name: string;
  note: string;
  code: string;
  enabled: boolean;
  maxUses: string;
  maxActiveSessions: string;
  perIpLimitMax: string;
  perIpLimitWindowMs: string;
}

export const defaultInviteForm: InviteFormState = {
  name: '',
  note: '',
  code: '',
  enabled: true,
  maxUses: '',
  maxActiveSessions: '1',
  perIpLimitMax: '3',
  perIpLimitWindowMs: '86400000',
};

export function toInviteForm(invite: ContributionInvite): InviteFormState {
  return {
    name: invite.name,
    note: invite.note,
    code: invite.code || '',
    enabled: invite.enabled,
    maxUses: invite.maxUses != null ? String(invite.maxUses) : '',
    maxActiveSessions: String(invite.maxActiveSessions),
    perIpLimitMax: String(invite.perIpLimitMax),
    perIpLimitWindowMs: String(invite.perIpLimitWindowMs),
  };
}

interface InviteFormModalProps {
  title: string;
  confirmLabel: string;
  form: InviteFormState;
  error: string;
  saving: boolean;
  onChange: (next: InviteFormState) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export default function InviteFormModal({ title, confirmLabel, form, error, saving, onChange, onSubmit, onClose }: InviteFormModalProps) {
  return (
    <BaseModal
      title={title}
      description="设置邀请码的基本信息、有效期限制与访问频率控制。"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">名称</label>
          <input className={inputClass} value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="例如：开发者社区" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">备注</label>
          <textarea className={inputClass} rows={2} value={form.note} onChange={(e) => onChange({ ...form, note: e.target.value })} placeholder="用途说明，例如面向哪些用户" />
        </div>

        <fieldset className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          <legend className="px-1 text-xs font-medium text-gray-600 dark:text-slate-400">邀请码</legend>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">自定义邀请码</label>
              <div className="flex gap-2">
                <input
                  className={`flex-1 ${inputClass}`}
                  value={form.code}
                  onChange={(e) => onChange({ ...form, code: e.target.value })}
                  placeholder="留空则由后端生成"
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...form, code: generateRandomCode() })}
                  className="rounded-lg bg-gray-100 dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600 whitespace-nowrap"
                >
                  随机生成
                </button>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-slate-500">
                仅支持字母、数字、下划线和短横线，长度 6-64。
              </p>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">最大使用次数</label>
              <div className="flex items-center gap-1">
                <input
                  className={inputClass}
                  type="number"
                  min="1"
                  value={form.maxUses}
                  onChange={(e) => onChange({ ...form, maxUses: e.target.value })}
                  placeholder="不限制"
                />
                <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">次</span>
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          <legend className="px-1 text-xs font-medium text-gray-600 dark:text-slate-400">会话与频率限制</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">最大活跃流程数</label>
              <input
                className={inputClass}
                type="number"
                min="1"
                value={form.maxActiveSessions}
                onChange={(e) => onChange({ ...form, maxActiveSessions: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">单 IP 次数限制</label>
              <div className="flex items-center gap-1">
                <input
                  className={inputClass}
                  type="number"
                  min="1"
                  value={form.perIpLimitMax}
                  onChange={(e) => onChange({ ...form, perIpLimitMax: e.target.value })}
                />
                <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">次</span>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-slate-400">单 IP 时间窗口</label>
              <select
                value={WINDOW_PRESETS.some((preset) => preset.value === form.perIpLimitWindowMs) ? form.perIpLimitWindowMs : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') {
                    onChange({ ...form, perIpLimitWindowMs: e.target.value });
                  }
                }}
                className={inputClass}
              >
                {WINDOW_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
                {!WINDOW_PRESETS.some((preset) => preset.value === form.perIpLimitWindowMs) && (
                  <option value="custom">自定义 ({formatDuration(Number(form.perIpLimitWindowMs))})</option>
                )}
              </select>
            </div>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
          <input type="checkbox" checked={form.enabled} onChange={(e) => onChange({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
          创建后立即启用
        </label>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryBtnClass}>取消</button>
          <button type="submit" disabled={saving} className={primaryBtnClass}>
            {saving && <Spinner className="mr-1.5 h-4 w-4" />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </BaseModal>
  );
}
