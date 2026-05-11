import { useState } from 'react';
import type { ContributionInvite, ContributionRecord } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';

interface Props {
  invites: ContributionInvite[];
  records: ContributionRecord[];
  onRefresh: () => void;
}

export default function ContributionsTab({ invites, records, onRefresh }: Props) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await api('POST', '/api/admin/contribution-invites', {
      name: name.trim(),
      note: note.trim(),
      code: code.trim() || undefined,
    });
    if (!res.ok) {
      setError(extractErrorMessage(res.data, '创建邀请码失败'));
      return;
    }
    setName('');
    setNote('');
    setCode('');
    onRefresh();
  };

  const review = async (recordId: string, action: 'approve' | 'reject') => {
    const res = await api('POST', `/api/admin/contributions/${recordId}/review`, {
      action,
      reviewerNote: reviewNotes[recordId] || '',
    });
    if (res.ok) onRefresh();
  };

  const toggleInvite = async (invite: ContributionInvite) => {
    const res = await api('PATCH', `/api/admin/contribution-invites/${invite.id}`, {
      enabled: !invite.enabled,
    });
    if (res.ok) onRefresh();
  };

  const removeInvite = async (invite: ContributionInvite) => {
    const res = await api('DELETE', `/api/admin/contribution-invites/${invite.id}`);
    if (res.ok) onRefresh();
  };

  return (
    <div className="space-y-6">
      <section className={`${cardClass} p-6`}>
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">邀请码</h2>
        <form onSubmit={createInvite} className="mt-4 grid gap-3 md:grid-cols-4">
          <input className={inputClass} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputClass} placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} />
          <input className={inputClass} placeholder="自定义邀请码（可选）" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className={primaryBtnClass}>创建</button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500 dark:text-slate-400">
              <tr>
                <th className="py-2">名称</th>
                <th className="py-2">邀请码</th>
                <th className="py-2">状态</th>
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
                  <td className="py-2">{invite.usedCount}{invite.maxUses ? ` / ${invite.maxUses}` : ''}</td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button type="button" className={secondaryBtnClass} onClick={() => toggleInvite(invite)}>
                        {invite.enabled ? '停用' : '启用'}
                      </button>
                      <button type="button" className={secondaryBtnClass} onClick={() => removeInvite(invite)}>
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
              {record.status === 'pending_review' ? (
                <textarea
                  className={`mt-3 ${inputClass}`}
                  rows={2}
                  placeholder="审核备注（可选）"
                  value={reviewNotes[record.id] || ''}
                  onChange={(e) => setReviewNotes((prev) => ({ ...prev, [record.id]: e.target.value }))}
                />
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
