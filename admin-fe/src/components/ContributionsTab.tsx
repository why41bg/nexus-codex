import { useEffect, useRef, useState } from 'react';
import type { ContributionInvite, ContributionRecord } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import {
  brandSubtleBtnClass,
  cardClass,
  dangerSubtleBtnClass,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  subtleBtnClass,
} from '@/lib/styles';
import ConfirmModal from './ConfirmModal';
import AdminPageHeader from './AdminPageHeader';
import Spinner from './Spinner';
import { CloseIcon, CopyIcon } from './icons';
import { useFocusTrap } from '../lib/use-focus-trap';
import { useToast } from '@/contexts/ToastContext';

interface Props {
  invites: ContributionInvite[];
  records: ContributionRecord[];
  onRefresh: () => void;
}

interface InviteFormState {
  name: string;
  note: string;
  code: string;
  enabled: boolean;
  maxUses: string;
  maxActiveSessions: string;
  perIpLimitMax: string;
  perIpLimitWindowMs: string;
}

const defaultInviteForm: InviteFormState = {
  name: '',
  note: '',
  code: '',
  enabled: true,
  maxUses: '',
  maxActiveSessions: '1',
  perIpLimitMax: '3',
  perIpLimitWindowMs: '86400000',
};

const WINDOW_PRESETS = [
  { label: '1 小时', value: '3600000' },
  { label: '6 小时', value: '21600000' },
  { label: '12 小时', value: '43200000' },
  { label: '24 小时', value: '86400000' },
  { label: '7 天', value: '604800000' },
];

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

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function toInviteForm(invite: ContributionInvite): InviteFormState {
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

function InviteFormModal({ title, confirmLabel, form, error, saving, onChange, onSubmit, onClose }: InviteFormModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = 'contribution-invite-form-modal-title';
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
          <div>
            <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              配置共享账号邀请码与 IP 频率限制，风格与 API Key 申领模板保持一致。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">名称</label>
            <input className={inputClass} value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="例如：社区共享入口" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">备注</label>
            <textarea className={inputClass} rows={2} value={form.note} onChange={(e) => onChange({ ...form, note: e.target.value })} placeholder="说明此邀请码的用途或适用人群" />
          </div>

          <fieldset className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600 dark:text-slate-400">邀请码设置</legend>
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
                    onClick={() => onChange({ ...form, code: generateInviteCode() })}
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
      </div>
    </div>
  );
}

export default function ContributionsTab({ invites, records, onRefresh }: Props) {
  const { toast } = useToast();
  const [createForm, setCreateForm] = useState<InviteFormState>(defaultInviteForm);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [approvedConcurrency, setApprovedConcurrency] = useState<Record<string, string>>({});
  const [editingInvite, setEditingInvite] = useState<ContributionInvite | null>(null);
  const [editForm, setEditForm] = useState<InviteFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContributionInvite | null>(null);
  const pendingRecords = records.filter((record) => record.status === 'pending_review');

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!createForm.name.trim()) {
      setError('邀请码名称不能为空');
      return;
    }
    if (createForm.code.trim() && !/^[A-Za-z0-9_-]{6,64}$/.test(createForm.code.trim())) {
      setError('邀请码只能包含字母、数字、下划线和短横线，长度 6-64');
      return;
    }
    setSavingCreate(true);
    try {
      const res = await api('POST', '/api/admin/contribution-invites', {
        name: createForm.name.trim(),
        note: createForm.note.trim(),
        code: createForm.code.trim() || undefined,
        enabled: createForm.enabled,
        maxUses: createForm.maxUses ? Number(createForm.maxUses) : undefined,
        maxActiveSessions: Number(createForm.maxActiveSessions || '1'),
        perIpLimitMax: Number(createForm.perIpLimitMax || '1'),
        perIpLimitWindowMs: Number(createForm.perIpLimitWindowMs || '86400000'),
      });
      if (!res.ok) {
        setError(extractErrorMessage(res.data, '创建邀请码失败'));
        return;
      }
      setCreateForm(defaultInviteForm);
      setShowCreateModal(false);
      onRefresh();
    } finally {
      setSavingCreate(false);
    }
  };

  const review = async (recordId: string, action: 'approve' | 'reject') => {
    const res = await api('POST', `/api/admin/contributions/${recordId}/review`, {
      action,
      reviewerNote: reviewNotes[recordId] || '',
      approvedMaxConcurrency:
        action === 'approve'
          ? Number(approvedConcurrency[recordId] || '0') || undefined
          : undefined,
    });
    if (res.ok) onRefresh();
  };

  const handleCopyInviteCode = async (code: string) => {
    await copyToClipboard(code);
    toast('邀请码已复制到剪贴板', 'success');
  };

  const toggleInvite = async (invite: ContributionInvite) => {
    const res = await api('PATCH', `/api/admin/contribution-invites/${invite.id}`, {
      enabled: !invite.enabled,
    });
    if (res.ok) onRefresh();
  };

  const removeInvite = async () => {
    if (!deleteTarget) return;
    const res = await api('DELETE', `/api/admin/contribution-invites/${deleteTarget.id}`);
    if (res.ok) onRefresh();
    setDeleteTarget(null);
  };

  const openEditInvite = (invite: ContributionInvite) => {
    setEditingInvite(invite);
    setEditForm(toInviteForm(invite));
  };

  const saveInvite = async () => {
    if (!editingInvite || !editForm) return;
    if (!editForm.name.trim()) {
      setError('邀请码名称不能为空');
      return;
    }
    if (editForm.code.trim() && !/^[A-Za-z0-9_-]{6,64}$/.test(editForm.code.trim())) {
      setError('邀请码只能包含字母、数字、下划线和短横线，长度 6-64');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await api('PATCH', `/api/admin/contribution-invites/${editingInvite.id}`, {
        name: editForm.name.trim(),
        note: editForm.note.trim(),
        code: editForm.code.trim(),
        enabled: editForm.enabled,
        maxUses: editForm.maxUses ? Number(editForm.maxUses) : null,
        maxActiveSessions: Number(editForm.maxActiveSessions || '1'),
        perIpLimitMax: Number(editForm.perIpLimitMax || '1'),
        perIpLimitWindowMs: Number(editForm.perIpLimitWindowMs || '86400000'),
      });
      if (!res.ok) {
        setError(extractErrorMessage(res.data, '更新邀请码失败'));
        return;
      }
      setError('');
      setEditingInvite(null);
      setEditForm(null);
      onRefresh();
    } finally {
      setSavingEdit(false);
    }
  };

  const pendingCount = pendingRecords.length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="共享贡献管理"
        description="管理共享邀请码，并审核待入池的共享账号贡献记录"
      />

      <section className={`${cardClass} p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">邀请码</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              配置共享账号入口的邀请码、使用次数与单 IP 限制。
            </p>
          </div>
          <button type="button" onClick={() => { setError(''); setCreateForm(defaultInviteForm); setShowCreateModal(true); }} className={primaryBtnClass}>
            创建邀请码
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {invites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
              暂无邀请码，点击右上角创建
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">邀请码</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">限制</th>
                <th className="px-4 py-3 font-medium">已用</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {invites.map((invite) => (
                <tr key={invite.id} className="transition-colors hover:bg-gray-50/50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{invite.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-600 dark:text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span>{invite.codeMasked}</span>
                    {invite.code ? (
                      <button
                        type="button"
                        className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                        onClick={() => handleCopyInviteCode(invite.code || '')}
                        title="复制邀请码"
                      >
                        <CopyIcon />
                      </button>
                    ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${invite.enabled ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                      {invite.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                    <div>最大活跃登录流程数: {invite.maxActiveSessions}</div>
                    <div>单 IP: {invite.perIpLimitMax} / {formatDuration(invite.perIpLimitWindowMs)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                    {invite.usedCount}{invite.maxUses ? ` / ${invite.maxUses}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" className={subtleBtnClass} onClick={() => toggleInvite(invite)}>
                        {invite.enabled ? '停用' : '启用'}
                      </button>
                      <button type="button" className={brandSubtleBtnClass} onClick={() => openEditInvite(invite)}>
                        编辑
                      </button>
                      <button type="button" className={dangerSubtleBtnClass} onClick={() => setDeleteTarget(invite)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </div>
      </section>

      {showCreateModal ? (
        <InviteFormModal
          title="创建邀请码"
          confirmLabel="创建"
          form={createForm}
          error={error}
          saving={savingCreate}
          onChange={setCreateForm}
          onSubmit={createInvite}
          onClose={() => {
            setShowCreateModal(false);
            setError('');
          }}
        />
      ) : null}

      {editingInvite && editForm ? (
        <InviteFormModal
          title="编辑邀请码"
          confirmLabel="保存"
          form={editForm}
          error={error}
          saving={savingEdit}
          onChange={setEditForm}
          onSubmit={(e) => {
            e.preventDefault();
            void saveInvite();
          }}
          onClose={() => {
            setEditingInvite(null);
            setEditForm(null);
            setError('');
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmModal
          title="删除邀请码"
          confirmLabel="删除"
          onConfirm={removeInvite}
          onCancel={() => setDeleteTarget(null)}
        >
          确认删除邀请码“{deleteTarget.name}”吗？已生成的历史贡献记录不会被删除。
        </ConfirmModal>
      ) : null}

      <section className={`${cardClass} p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">共享贡献审核</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              审核共享账号登录后的待入池记录，并确认最终并发度。
            </p>
          </div>
          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            待审核 {pendingCount} 条
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {pendingRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
              暂无待审核的共享贡献记录
            </div>
          ) : pendingRecords.map((record) => (
            <div key={record.id} className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                    {record.applicantName} · {record.inviteName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {record.applicantContact} · {record.clientIp} · {record.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className={primaryBtnClass} onClick={() => review(record.id, 'approve')}>批准</button>
                  <button className={secondaryBtnClass} onClick={() => review(record.id, 'reject')}>拒绝</button>
                </div>
              </div>
              {record.note ? <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{record.note}</p> : null}
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                建议并发度：{record.requestedMaxConcurrency}
                {record.approvedMaxConcurrency ? ` · 最终并发度：${record.approvedMaxConcurrency}` : ''}
              </p>
              <div className="mt-3 space-y-3">
                <input
                  className={inputClass}
                  type="number"
                  min="1"
                  placeholder="最终并发度（默认采用建议值）"
                  value={approvedConcurrency[record.id] ?? String(record.requestedMaxConcurrency)}
                  onChange={(e) => setApprovedConcurrency((prev) => ({ ...prev, [record.id]: e.target.value }))}
                />
                <textarea
                  className={inputClass}
                  rows={2}
                  placeholder="审核备注（可选）"
                  value={reviewNotes[record.id] || ''}
                  onChange={(e) => setReviewNotes((prev) => ({ ...prev, [record.id]: e.target.value }))}
                />
              </div>
              {record.accountId ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  accountId: {record.accountId} {record.accountPlanType ? `· ${record.accountPlanType}` : ''}
                </p>
              ) : null}
              {record.duplicateAccountId ? (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  检测到重复账号：{record.duplicateAccountId}
                </p>
              ) : null}
              {record.reviewerNote ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">审核备注：{record.reviewerNote}</p>
              ) : null}
              {record.error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{record.error}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
