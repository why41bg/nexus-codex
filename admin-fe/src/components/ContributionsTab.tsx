import { useState } from 'react';
import type { ContributionInvite, ContributionRecord } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import ConfirmModal from './ConfirmModal';

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

export default function ContributionsTab({ invites, records, onRefresh }: Props) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [maxUses, setMaxUses] = useState('');
  const [maxActiveSessions, setMaxActiveSessions] = useState('1');
  const [perIpLimitMax, setPerIpLimitMax] = useState('3');
  const [perIpLimitWindowMs, setPerIpLimitWindowMs] = useState('86400000');
  const [error, setError] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [approvedConcurrency, setApprovedConcurrency] = useState<Record<string, string>>({});
  const [editingInvite, setEditingInvite] = useState<ContributionInvite | null>(null);
  const [editForm, setEditForm] = useState<InviteFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContributionInvite | null>(null);

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('邀请码名称不能为空');
      return;
    }
    if (code.trim() && !/^[A-Za-z0-9_-]{6,64}$/.test(code.trim())) {
      setError('邀请码只能包含字母、数字、下划线和短横线，长度 6-64');
      return;
    }
    const res = await api('POST', '/api/admin/contribution-invites', {
      name: name.trim(),
      note: note.trim(),
      code: code.trim() || undefined,
      enabled,
      maxUses: maxUses ? Number(maxUses) : undefined,
      maxActiveSessions: Number(maxActiveSessions || '1'),
      perIpLimitMax: Number(perIpLimitMax || '1'),
      perIpLimitWindowMs: Number(perIpLimitWindowMs || '86400000'),
    });
    if (!res.ok) {
      setError(extractErrorMessage(res.data, '创建邀请码失败'));
      return;
    }
    setName('');
    setNote('');
    setCode('');
    setEnabled(true);
    setMaxUses('');
    setMaxActiveSessions('1');
    setPerIpLimitMax('3');
    setPerIpLimitWindowMs('86400000');
    onRefresh();
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
  };

  return (
    <div className="space-y-6">
      <section className={`${cardClass} p-6`}>
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">邀请码</h2>
        <form onSubmit={createInvite} className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <input className={inputClass} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={inputClass} placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} />
            <input className={inputClass} placeholder="自定义邀请码（可选）" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="submit" className={primaryBtnClass}>创建</button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <input className={inputClass} type="number" min="1" placeholder="最大使用次数（可选）" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            <input className={inputClass} type="number" min="1" placeholder="最大活跃流程数" value={maxActiveSessions} onChange={(e) => setMaxActiveSessions(e.target.value)} />
            <input className={inputClass} type="number" min="1" placeholder="单 IP 次数限制" value={perIpLimitMax} onChange={(e) => setPerIpLimitMax(e.target.value)} />
            <input className={inputClass} type="number" min="60000" placeholder="单 IP 窗口(ms)" value={perIpLimitWindowMs} onChange={(e) => setPerIpLimitWindowMs(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            创建后立即启用
          </label>
        </form>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          自定义邀请码仅支持字母、数字、下划线和短横线，长度 6-64。
        </p>
        {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500 dark:text-slate-400">
              <tr>
                <th className="py-2">名称</th>
                <th className="py-2">邀请码</th>
                <th className="py-2">状态</th>
                <th className="py-2">限制</th>
                <th className="py-2">已用</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="py-2 text-gray-900 dark:text-slate-100">{invite.name}</td>
                  <td className="py-2 font-mono text-gray-600 dark:text-slate-300">
                    <div>{invite.codeMasked}</div>
                    {invite.code ? (
                      <button
                        type="button"
                        className="mt-1 text-xs text-brand-600 dark:text-brand-400"
                        onClick={() => copyToClipboard(invite.code || '')}
                      >
                        复制明文
                      </button>
                    ) : null}
                  </td>
                  <td className="py-2">{invite.enabled ? '启用' : '停用'}</td>
                  <td className="py-2 text-xs text-gray-500 dark:text-slate-400">
                    <div>活跃流程: {invite.maxActiveSessions}</div>
                    <div>单 IP: {invite.perIpLimitMax} / {invite.perIpLimitWindowMs}ms</div>
                  </td>
                  <td className="py-2">{invite.usedCount}{invite.maxUses ? ` / ${invite.maxUses}` : ''}</td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button type="button" className={secondaryBtnClass} onClick={() => toggleInvite(invite)}>
                        {invite.enabled ? '停用' : '启用'}
                      </button>
                      <button type="button" className={secondaryBtnClass} onClick={() => openEditInvite(invite)}>
                        编辑
                      </button>
                      <button type="button" className={secondaryBtnClass} onClick={() => setDeleteTarget(invite)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingInvite && editForm ? (
        <ConfirmModal
          title="编辑邀请码"
          confirmLabel="保存"
          confirmColor="brand"
          onConfirm={saveInvite}
          onCancel={() => {
            setEditingInvite(null);
            setEditForm(null);
          }}
        >
          <div className="mt-3 space-y-3">
            <input className={inputClass} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="名称" />
            <input className={inputClass} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} placeholder="备注" />
            <input className={inputClass} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} placeholder="邀请码" />
            <div className="grid grid-cols-2 gap-3">
              <input className={inputClass} type="number" min="1" value={editForm.maxUses} onChange={(e) => setEditForm({ ...editForm, maxUses: e.target.value })} placeholder="最大使用次数" />
              <input className={inputClass} type="number" min="1" value={editForm.maxActiveSessions} onChange={(e) => setEditForm({ ...editForm, maxActiveSessions: e.target.value })} placeholder="最大活跃流程数" />
              <input className={inputClass} type="number" min="1" value={editForm.perIpLimitMax} onChange={(e) => setEditForm({ ...editForm, perIpLimitMax: e.target.value })} placeholder="单 IP 次数限制" />
              <input className={inputClass} type="number" min="60000" value={editForm.perIpLimitWindowMs} onChange={(e) => setEditForm({ ...editForm, perIpLimitWindowMs: e.target.value })} placeholder="单 IP 窗口(ms)" />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={editForm.enabled} onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })} />
              启用邀请码
            </label>
          </div>
        </ConfirmModal>
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
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">共享贡献审核</h2>
        <div className="mt-4 space-y-3">
          {records.map((record) => (
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
                {record.status === 'pending_review' ? (
                  <div className="flex gap-2">
                    <button className={primaryBtnClass} onClick={() => review(record.id, 'approve')}>批准</button>
                    <button className={secondaryBtnClass} onClick={() => review(record.id, 'reject')}>拒绝</button>
                  </div>
                ) : null}
              </div>
              {record.note ? <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{record.note}</p> : null}
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                建议并发度：{record.requestedMaxConcurrency}
                {record.approvedMaxConcurrency ? ` · 最终并发度：${record.approvedMaxConcurrency}` : ''}
              </p>
              {record.status === 'pending_review' ? (
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
              ) : null}
              {record.accountId ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  accountId: {record.accountId} {record.accountPlanType ? `· ${record.accountPlanType}` : ''}
                </p>
              ) : null}
              {(record.status === 'approved' || record.status === 'rejected') ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  {record.status === 'approved' ? '审核完成，bootstrap 会话已收尾，账号目录保留用于正式入池。' : '审核完成，bootstrap 会话与待审核目录已清理。'}
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
