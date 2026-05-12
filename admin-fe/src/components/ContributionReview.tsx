import { useState } from 'react';
import type { ContributionRecord } from '@/types';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useReviewContribution } from '@/hooks/useAdminMutations';

interface Props {
  records: ContributionRecord[];
}

export default function ContributionReview({ records }: Props) {
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [approvedConcurrency, setApprovedConcurrency] = useState<Record<string, string>>({});

  const reviewMutation = useReviewContribution();

  const pendingRecords = records.filter((record) => record.status === 'pending_review');
  const pendingCount = pendingRecords.length;

  const review = (recordId: string, action: 'approve' | 'reject') => {
    reviewMutation.mutate({
      recordId,
      body: {
        action,
        reviewerNote: reviewNotes[recordId] || '',
        approvedMaxConcurrency:
          action === 'approve'
            ? Number(approvedConcurrency[recordId] || '0') || undefined
            : undefined,
      },
    });
  };

  return (
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
  );
}
