import { useState, useMemo, useCallback } from 'react';
import type { Account, QuotaInfo } from '@/types';
import { relativeTime } from '@/lib/time';
import { api, extractErrorMessage } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import EditAccountModal from './EditAccountModal';
import AccountDetailModal from './AccountDetailModal';
import Spinner from './Spinner';

type FilterKey = 'all' | 'online' | 'active' | 'unhealthy' | 'disabled';

function getAccountStatus(acc: Account): { dot: string; text: string; label: string } {
  if (!acc.enabled) return { dot: 'bg-gray-400', text: 'text-gray-400', label: '已禁用' };
  if (!acc.runtime?.healthy) return { dot: 'bg-red-500', text: 'text-red-600', label: '不健康' };
  const active = acc.runtime?.activeCount ?? 0;
  const max = acc.runtime?.maxConcurrency ?? 0;
  if (active >= max) return { dot: 'bg-amber-400', text: 'text-amber-600', label: '满载' };
  if (active > 0) return { dot: 'bg-blue-400', text: 'text-blue-600', label: '部分占用' };
  return { dot: 'bg-green-500', text: 'text-green-600', label: '空闲' };
}

/** 将 Unix 时间戳（秒）格式化为剩余时间字符串 */
function formatResetsIn(resetsAt: number): string {
  const diffMs = resetsAt * 1000 - Date.now();
  if (diffMs <= 0) return '已重置';
  const totalMins = Math.floor(diffMs / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

/** 额度进度条颜色 */
function quotaBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-400';
  return 'bg-green-500';
}

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

  // 每个账号的额度状态，key = accountId
  const [quotaMap, setQuotaMap] = useState<Record<string, QuotaState>>({});

  // 计算筛选项统计
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

  // 过滤后的账号列表
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
      {/* Filter Tabs */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex gap-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        {/* Loading */}
        {loading && accounts.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6 text-brand-600" />
            <span className="ml-2 text-sm text-gray-500">加载中...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-gray-400">暂无账号</div>
        )}

        {/* Data */}
        {filtered.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/60">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500">账号</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-500">并发</th>
                <th className="px-4 py-3 font-medium text-gray-500">额度</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500">使用情况</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((acc) => {
                const qs = quotaMap[acc.id];
                const status = getAccountStatus(acc);
                return (
                  <tr key={acc.id} className="transition-colors hover:bg-gray-50/50">
                    {/* 账号列：状态 + ID + 备注 */}
                    <td
                      className="cursor-pointer px-4 py-3"
                      onClick={() => setDetailTarget(acc)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-medium text-gray-800">{acc.id}</span>
                            <span className={`text-[10px] ${status.text}`}>{status.label}</span>
                          </div>
                          {acc.remark && (
                            <div className="mt-0.5 truncate text-xs text-gray-400">{acc.remark}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 并发列 */}
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-gray-700">
                      {acc.runtime ? `${acc.runtime.activeCount} / ${acc.runtime.maxConcurrency}` : '—'}
                    </td>

                    {/* 额度列 */}
                    <td className="px-4 py-3">
                      {!qs && (
                        <button
                          onClick={(e) => { e.stopPropagation(); fetchQuota(acc); }}
                          className="rounded px-2 py-0.5 text-xs text-brand-600 hover:bg-brand-50 transition-colors"
                        >
                          查询
                        </button>
                      )}
                      {qs?.loading && (
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Spinner className="h-3 w-3" />
                          <span>查询中</span>
                        </div>
                      )}
                      {qs?.error && (
                        <button
                          onClick={(e) => { e.stopPropagation(); fetchQuota(acc); }}
                          className="text-xs text-red-500 hover:underline"
                          title={qs.error}
                        >
                          失败，重试
                        </button>
                      )}
                      {qs?.data && (
                        <div className="flex flex-col gap-1">
                          <QuotaBar
                            label="5h"
                            pct={qs.data.primary.usedPercent}
                            resetsAt={qs.data.primary.resetsAt}
                          />
                          <QuotaBar
                            label="1w"
                            pct={qs.data.secondary.usedPercent}
                            resetsAt={qs.data.secondary.resetsAt}
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchQuota(acc, true); }}
                            className="self-start text-[10px] text-gray-400 hover:text-brand-600 transition-colors"
                          >
                            刷新
                          </button>
                        </div>
                      )}
                    </td>

                    {/* 使用情况列：次数 + 最后使用 */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="tabular-nums text-gray-700">{acc.usageCount}</div>
                      <div className="mt-0.5 text-xs text-gray-400">{relativeTime(acc.lastUsedAt)}</div>
                    </td>

                    {/* 操作列 */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditTarget(acc); }}
                          className="rounded-md bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                        >
                          编辑
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleEnabled(acc); }}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            acc.enabled
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'bg-green-50 text-green-700 hover:bg-green-100'
                          }`}
                        >
                          {acc.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(acc); }}
                          className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
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
        )}
      </div>

      {/* Detail Modal */}
      {detailTarget && (
        <AccountDetailModal
          account={detailTarget}
          quota={quotaMap[detailTarget.id]?.data ?? null}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* Edit Modal */}
      {editTarget && (
        <EditAccountModal
          account={editTarget}
          onSaved={() => { setEditTarget(null); onRefresh(); }}
          onCancel={() => setEditTarget(null)}
        />
      )}

      {/* Delete Confirm Modal */}
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

// ─── QuotaBar 子组件 ─────────────────────────────────────────

interface QuotaBarProps {
  label: string;
  pct: number;
  resetsAt: number;
}

function QuotaBar({ label, pct, resetsAt }: QuotaBarProps) {
  const clampedPct = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-[10px] font-medium text-gray-400">{label}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${quotaBarColor(clampedPct)}`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-gray-500">
        {clampedPct}%
      </span>
      <span className="text-[10px] text-gray-400" title={`重置于 ${new Date(resetsAt * 1000).toLocaleString()}`}>
        {formatResetsIn(resetsAt)}
      </span>
    </div>
  );
}
