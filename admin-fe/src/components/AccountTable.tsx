import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Account, QuotaInfo } from '@/types';
import { relativeTime } from '@/lib/time';
import { api, extractErrorMessage } from '@/lib/api';
import { getAccountStatus, formatResetsIn, quotaBarColor } from '@/lib/account-utils';
import { cardClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import EditAccountModal from './EditAccountModal';
import AccountDetailModal from './AccountDetailModal';
import Spinner from './Spinner';

type FilterKey = 'all' | 'online' | 'active' | 'unhealthy' | 'disabled';

interface QuotaState {
  loading: boolean;
  data: QuotaInfo | null;
  error: string | null;
}

interface Props {
  accounts: Account[];
  loading: boolean;
  onRefresh: () => void;
}

export default function AccountTable({ accounts, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [detailTarget, setDetailTarget] = useState<Account | null>(null);

  const [quotaMap, setQuotaMap] = useState<Record<string, QuotaState>>({});

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const filterTabs = useMemo(() => {
    const counts = { all: accounts.length, online: 0, active: 0, unhealthy: 0, disabled: 0 };
    for (const a of accounts) {
      if (!a.enabled) { counts.disabled++; continue; }
      if (!a.runtime?.healthy) { counts.unhealthy++; continue; }
      const active = a.runtime?.activeCount ?? 0;
      if (active > 0) counts.active++;
      else counts.online++;
    }
    return [
      { key: 'all' as const, label: '\u5168\u90e8', count: counts.all },
      { key: 'online' as const, label: '\u7a7a\u95f2', count: counts.online },
      { key: 'active' as const, label: '\u4f7f\u7528\u4e2d', count: counts.active },
      { key: 'unhealthy' as const, label: '\u4e0d\u5065\u5eb7', count: counts.unhealthy },
      { key: 'disabled' as const, label: '\u5df2\u7981\u7528', count: counts.disabled },
    ];
  }, [accounts]);

  const filtered = useMemo(() => {
    if (filter === 'all') return accounts;
    return accounts.filter((a) => {
      if (filter === 'disabled') return !a.enabled;
      if (!a.enabled) return false;
      if (filter === 'active') return a.runtime?.healthy && (a.runtime?.activeCount ?? 0) > 0;
      if (filter === 'unhealthy') return !a.runtime?.healthy;
      if (filter === 'online') return a.runtime?.healthy && (a.runtime?.activeCount ?? 0) === 0;
      return true;
    });
  }, [accounts, filter]);

  const fetchQuota = useCallback(async (acc: Account, forceRefresh = false) => {
    setQuotaMap((prev) => ({
      ...prev,
      [acc.id]: { loading: true, data: prev[acc.id]?.data ?? null, error: null },
    }));
    try {
      const res = await api<{ quota?: QuotaInfo; error?: { message: string } }>(
        forceRefresh ? 'POST' : 'GET',
        forceRefresh
          ? `/api/admin/accounts/${acc.id}/quota/refresh`
          : `/api/admin/accounts/${acc.id}/quota`,
      );
      if (authGuard(res.status)) return;
      if (res.ok && res.data.quota) {
        setQuotaMap((prev) => ({
          ...prev,
          [acc.id]: { loading: false, data: res.data.quota!, error: null },
        }));
      } else {
        const msg = extractErrorMessage(res.data, '\u83b7\u53d6\u989d\u5ea6\u5931\u8d25');
        setQuotaMap((prev) => ({
          ...prev,
          [acc.id]: { loading: false, data: null, error: msg },
        }));
        toast(msg, 'error');
      }
    } catch {
      setQuotaMap((prev) => ({
        ...prev,
        [acc.id]: { loading: false, data: null, error: '\u8bf7\u6c42\u5931\u8d25' },
      }));
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    }
  }, [authGuard, toast]);

  const toggleEnabled = async (acc: Account) => {
    const newEnabled = !acc.enabled;
    try {
      const res = await api('PATCH', `/api/admin/accounts/${acc.id}`, { enabled: newEnabled });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast(newEnabled ? `\u5df2\u542f\u7528 ${acc.id}` : `\u5df2\u7981\u7528 ${acc.id}`, 'success');
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '\u64cd\u4f5c\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api('DELETE', `/api/admin/accounts/${deleteTarget.id}`);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast(`\u5df2\u5220\u9664 ${deleteTarget.id}`, 'success');
        setDeleteTarget(null);
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '\u5220\u9664\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-8">
      {/* Filter Tabs */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 pb-3">
        <div className="flex gap-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && accounts.length === 0 && (
        <div className="mt-4 flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-600" />
          <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">\u52a0\u8f7d\u4e2d...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="mt-4 py-16 text-center text-sm text-gray-400 dark:text-slate-500">\u6682\u65e0\u8d26\u53f7</div>
      )}

      {filtered.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className={`mt-4 hidden overflow-hidden ${cardClass} md:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u8d26\u53f7</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u5e76\u53d1</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">\u989d\u5ea6</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500 dark:text-slate-400">\u4f7f\u7528\u60c5\u51b5</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500 dark:text-slate-400">\u64cd\u4f5c</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {filtered.map((acc) => {
                  const qs = quotaMap[acc.id];
                  const status = getAccountStatus(acc);
                  return (
                    <tr key={acc.id} className="transition-colors hover:bg-gray-50/50 dark:hover:bg-slate-700/50">
                      <td
                        className="cursor-pointer px-4 py-3"
                        onClick={() => setDetailTarget(acc)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-medium text-gray-800 dark:text-slate-200">{acc.id}</span>
                              <span className={`text-[10px] ${status.text}`}>{status.label}</span>
                            </div>
                            {acc.remark && (
                              <div className="mt-0.5 truncate text-xs text-gray-400 dark:text-slate-500">{acc.remark}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-gray-700 dark:text-slate-300">
                        {acc.runtime ? `${acc.runtime.activeCount} / ${acc.runtime.maxConcurrency}` : '\u2014'}
                      </td>

                      <td className="px-4 py-3">
                        {!qs && (
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchQuota(acc); }}
                            className="rounded px-2 py-0.5 text-xs text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
                          >
                            \u67e5\u8be2
                          </button>
                        )}
                        {qs?.loading && (
                          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                            <Spinner className="h-3 w-3" />
                            <span>\u67e5\u8be2\u4e2d</span>
                          </div>
                        )}
                        {qs?.error && (
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchQuota(acc); }}
                            className="text-xs text-red-500 dark:text-red-400 hover:underline"
                            title={qs.error}
                          >
                            \u5931\u8d25\uff0c\u91cd\u8bd5
                          </button>
                        )}
                        {qs?.data && (
                          <div className="flex flex-col gap-1">
                            <QuotaBar label="5h" pct={qs.data.primary.usedPercent} resetsAt={qs.data.primary.resetsAt} />
                            <QuotaBar label="1w" pct={qs.data.secondary.usedPercent} resetsAt={qs.data.secondary.resetsAt} />
                            <button
                              onClick={(e) => { e.stopPropagation(); fetchQuota(acc, true); }}
                              className="self-start text-[10px] text-gray-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                            >
                              \u5237\u65b0
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="tabular-nums text-gray-700 dark:text-slate-300">{acc.usageCount}</div>
                        <div className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">{relativeTime(acc.lastUsedAt)}</div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditTarget(acc); }}
                            className="rounded-md bg-gray-50 dark:bg-slate-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 transition-colors hover:bg-gray-100 dark:hover:bg-slate-600"
                          >
                            \u7f16\u8f91
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleEnabled(acc); }}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              acc.enabled
                                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900'
                                : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-400 dark:hover:bg-green-900'
                            }`}
                          >
                            {acc.enabled ? '\u7981\u7528' : '\u542f\u7528'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(acc); }}
                            className="rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
                          >
                            \u5220\u9664
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List */}
          <div className="mt-4 space-y-3 md:hidden">
            {filtered.map((acc) => {
              const status = getAccountStatus(acc);
              return (
                <div
                  key={acc.id}
                  className={`${cardClass} p-4`}
                  onClick={() => setDetailTarget(acc)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
                    <span className="font-mono text-xs font-medium text-gray-800 dark:text-slate-200 truncate">{acc.id}</span>
                    <span className={`text-[10px] ${status.text}`}>{status.label}</span>
                  </div>

                  {acc.remark && (
                    <div className="mt-1 truncate text-xs text-gray-400 dark:text-slate-500">{acc.remark}</div>
                  )}

                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-600 dark:text-slate-400">
                    <span>
                      \u5e76\u53d1: <span className="font-mono tabular-nums">
                        {acc.runtime ? `${acc.runtime.activeCount}/${acc.runtime.maxConcurrency}` : '\u2014'}
                      </span>
                    </span>
                    <span>
                      \u4f7f\u7528: <span className="tabular-nums">{acc.usageCount}</span>
                    </span>
                    {acc.lastUsedAt && (
                      <span className="text-gray-400 dark:text-slate-500">{relativeTime(acc.lastUsedAt)}</span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 dark:border-slate-700 pt-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditTarget(acc); }}
                      className="rounded-md bg-gray-50 dark:bg-slate-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 transition-colors hover:bg-gray-100 dark:hover:bg-slate-600"
                    >
                      \u7f16\u8f91
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleEnabled(acc); }}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        acc.enabled
                          ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900'
                          : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-400 dark:hover:bg-green-900'
                      }`}
                    >
                      {acc.enabled ? '\u7981\u7528' : '\u542f\u7528'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(acc); }}
                      className="rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
                    >
                      \u5220\u9664
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {detailTarget && (
        <AccountDetailModal
          account={detailTarget}
          quota={quotaMap[detailTarget.id]?.data ?? null}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {editTarget && (
        <EditAccountModal
          account={editTarget}
          onSaved={() => { setEditTarget(null); onRefresh(); }}
          onCancel={() => setEditTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="\u786e\u8ba4\u5220\u9664"
          confirmLabel="\u5220\u9664"
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            \u786e\u5b9a\u8981\u5220\u9664\u8d26\u53f7 <span className="font-mono font-semibold">{deleteTarget.id}</span>
            {deleteTarget.remark && <span>\uff08{deleteTarget.remark}\uff09</span>}
            \u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

// \u2500\u2500\u2500 QuotaBar \u5b50\u7ec4\u4ef6 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface QuotaBarProps {
  label: string;
  pct: number;
  resetsAt: number;
}

function QuotaBar({ label, pct, resetsAt }: QuotaBarProps) {
  const clampedPct = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-[10px] font-medium text-gray-400 dark:text-slate-500">{label}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${quotaBarColor(clampedPct)}`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-gray-500 dark:text-slate-400">
        {clampedPct}%
      </span>
      <span className="text-[10px] text-gray-400 dark:text-slate-500" title={`\u91cd\u7f6e\u4e8e ${new Date(resetsAt * 1000).toLocaleString()}`}>
        {formatResetsIn(resetsAt)}
      </span>
    </div>
  );
}
