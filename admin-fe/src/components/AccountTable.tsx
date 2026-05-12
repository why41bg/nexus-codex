import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Account, QuotaInfo } from '@/types';
import { relativeTime } from '@/lib/time';
import { api, extractErrorMessage } from '@/lib/api';
import { getAccountStatus, formatResetsIn, quotaBarColor } from '@/lib/account-utils';
import {
  cardClass,
  dangerSubtleBtnClass,
  filterTabBtnClass,
  filterTabsWrapClass,
  subtleBtnClass,
  successSubtleBtnClass,
  warningSubtleBtnClass,
} from '@/lib/styles';
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
  const [batchFetching, setBatchFetching] = useState(false);

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
      { key: 'all' as const, label: '全部', count: counts.all },
      { key: 'online' as const, label: '空闲', count: counts.online },
      { key: 'active' as const, label: '使用中', count: counts.active },
      { key: 'unhealthy' as const, label: '不健康', count: counts.unhealthy },
      { key: 'disabled' as const, label: '已禁用', count: counts.disabled },
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

  const fetchAllQuota = useCallback(async () => {
    setBatchFetching(true);
    // Mark all accounts as loading
    setQuotaMap((prev) => {
      const next = { ...prev };
      for (const acc of accounts) {
        next[acc.id] = { loading: true, data: prev[acc.id]?.data ?? null, error: null };
      }
      return next;
    });
    try {
      const res = await api<{ quotas?: Record<string, { quota?: QuotaInfo; error?: { message: string } }> }>(
        'POST',
        '/api/admin/accounts/quota/batch',
      );
      if (authGuard(res.status)) { setBatchFetching(false); return; }
      if (res.ok && res.data.quotas) {
        setQuotaMap((prev) => {
          const next = { ...prev };
          for (const [id, result] of Object.entries(res.data.quotas!)) {
            if (result.quota) {
              next[id] = { loading: false, data: result.quota, error: null };
            } else {
              const msg = extractErrorMessage(result, '获取额度失败');
              next[id] = { loading: false, data: null, error: msg };
            }
          }
          return next;
        });
        toast('已刷新全部账号额度', 'success');
      } else {
        const msg = extractErrorMessage(res.data, '批量查询失败');
        toast(msg, 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setBatchFetching(false);
    }
  }, [accounts, authGuard, toast]);

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
        const msg = extractErrorMessage(res.data, '获取额度失败');
        setQuotaMap((prev) => ({
          ...prev,
          [acc.id]: { loading: false, data: null, error: msg },
        }));
        toast(msg, 'error');
      }
    } catch {
      setQuotaMap((prev) => ({
        ...prev,
        [acc.id]: { loading: false, data: null, error: '请求失败' },
      }));
      toast('请求失败', 'error');
    }
  }, [authGuard, toast]);

  const toggleEnabled = async (acc: Account) => {
    const newEnabled = !acc.enabled;
    try {
      const res = await api('PATCH', `/api/admin/accounts/${acc.id}`, { enabled: newEnabled });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast(newEnabled ? `已启用 ${acc.id}` : `已禁用 ${acc.id}`, 'success');
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '操作失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api('DELETE', `/api/admin/accounts/${deleteTarget.id}`);
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast(`已删除 ${deleteTarget.id}`, 'success');
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
    <div className="mt-8">
      <div className={filterTabsWrapClass}>
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={filterTabBtnClass(filter === tab.key)}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && accounts.length === 0 && (
        <div className="mt-4 flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-600" />
          <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="mt-4 py-16 text-center text-sm text-gray-400 dark:text-slate-500">暂无账号</div>
      )}

      {filtered.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className={`mt-4 hidden overflow-hidden ${cardClass} md:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">账号</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-500 dark:text-slate-400">并发</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <span>额度</span>
                      <button
                        onClick={fetchAllQuota}
                        disabled={batchFetching}
                        className="rounded px-2 py-0.5 text-[11px] font-normal text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {batchFetching ? '查询中...' : '一键查询'}
                      </button>
                    </div>
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500 dark:text-slate-400">使用情况</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500 dark:text-slate-400">操作</th>
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
                        {acc.runtime ? `${acc.runtime.activeCount} / ${acc.runtime.maxConcurrency}` : '—'}
                      </td>

                      <td className="px-4 py-3">
                        {!qs && (
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchQuota(acc); }}
                            className="rounded px-2 py-0.5 text-xs text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
                          >
                            查询
                          </button>
                        )}
                        {qs?.loading && (
                          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                            <Spinner className="h-3 w-3" />
                            <span>查询中</span>
                          </div>
                        )}
                        {qs?.error && (
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchQuota(acc); }}
                            className="text-xs text-red-500 dark:text-red-400 hover:underline"
                            title={qs.error}
                          >
                            失败，重试
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
                              刷新
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
                            className={subtleBtnClass}
                          >
                            编辑
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleEnabled(acc); }}
                            className={acc.enabled ? warningSubtleBtnClass : successSubtleBtnClass}
                          >
                            {acc.enabled ? '禁用' : '启用'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(acc); }}
                            className={dangerSubtleBtnClass}
                          >
                            删除
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
                      并发: <span className="font-mono tabular-nums">
                        {acc.runtime ? `${acc.runtime.activeCount}/${acc.runtime.maxConcurrency}` : '—'}
                      </span>
                    </span>
                    <span>
                      使用: <span className="tabular-nums">{acc.usageCount}</span>
                    </span>
                    {acc.lastUsedAt && (
                      <span className="text-gray-400 dark:text-slate-500">{relativeTime(acc.lastUsedAt)}</span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 dark:border-slate-700 pt-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditTarget(acc); }}
                      className={subtleBtnClass}
                    >
                      编辑
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleEnabled(acc); }}
                      className={acc.enabled ? warningSubtleBtnClass : successSubtleBtnClass}
                    >
                      {acc.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(acc); }}
                      className={dangerSubtleBtnClass}
                    >
                      删除
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
          title="确认删除"
          confirmLabel="删除"
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            确定要删除账号 <span className="font-mono font-semibold">{deleteTarget.id}</span>
            {deleteTarget.remark && <span>（{deleteTarget.remark}）</span>}
            吗？此操作不可撤销。
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

// ─── QuotaBar 子组件 ─────────────────────────────────────────────

interface QuotaBarProps {
  label: string;
  pct: number;
  resetsAt: number;
}

function QuotaBar({ label, pct, resetsAt }: QuotaBarProps) {
  const clampedPct = Math.min(100, Math.max(0, pct));
  const remainingPct = 100 - clampedPct;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-[10px] font-medium text-gray-400 dark:text-slate-500">{label}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${quotaBarColor(remainingPct)}`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-gray-500 dark:text-slate-400">
        {remainingPct}%
      </span>
      <span className="text-[10px] text-gray-400 dark:text-slate-500" title={`重置于 ${new Date(resetsAt * 1000).toLocaleString()}`}>
        {formatResetsIn(resetsAt)}
      </span>
    </div>
  );
}
