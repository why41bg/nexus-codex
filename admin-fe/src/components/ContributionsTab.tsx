import { useState } from 'react';
import type { ContributionInvite, ContributionRecord } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { formatDuration } from '@/lib/time';
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
import InviteFormModal, { type InviteFormState, defaultInviteForm, toInviteForm } from './InviteFormModal';
import AdminPageHeader from './AdminPageHeader';
import { CopyIcon } from './icons';
import { useToast } from '@/contexts/ToastContext';

interface Props {
  invites: ContributionInvite[];
  records: ContributionRecord[];
  onRefresh: () => void;
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
        title="账号共享"
        description="通过邀请码让社区成员共享闲置账号，并在此审核入池申请"
      />

      <section className={`${cardClass} p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">邀请码管理</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              创建并管理共享入口的邀请码，控制使用次数与访问频率。
            </p>
          </div>
          <button type="button" onClick={() => { setError(''); setCreateForm(defaultInviteForm); setShowCreateModal(true); }} className={primaryBtnClass}>
            创建邀请码
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {invites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
              尚未创建邀请码，点击上方按钮开始
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
                    <div>同时在线: {invite.maxActiveSessions}</div>
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
          确定删除邀请码「{deleteTarget.name}」吗？已产生的共享记录不受影响。
        </ConfirmModal>
      ) : null}

      <section className={`${cardClass} p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">入池审核</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              审核社区提交的共享账号，确认后自动加入资源池。
            </p>
          </div>
          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            {pendingCount} 条待审
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {pendingRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
              暂无待审核的共享申请
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
                建议并发数：{record.requestedMaxConcurrency}
                {record.approvedMaxConcurrency ? ` · 批准并发数：${record.approvedMaxConcurrency}` : ''}
              </p>
              <div className="mt-3 space-y-3">
                <input
                  className={inputClass}
                  type="number"
                  min="1"
                  placeholder="批准并发数（留空则采用建议值）"
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
