import { useState, useRef, useEffect, useMemo } from 'react';
import type { BannedIP } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { relativeTime } from '@/lib/time';
import ConfirmModal from './ConfirmModal';

// ─── Helper Components ──────────────────────────────────────────

/** 可展开的原因单元格：文本过长时截断，hover 显示完整 Tooltip */
function ReasonCell({ reason }: { reason: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [reason]);

  return (
    <div className="relative max-w-xs group">
      <span
        ref={textRef}
        className="block truncate cursor-default"
        onMouseEnter={() => isTruncated && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {reason}
      </span>
      {showTooltip && (
        <div className="absolute left-0 bottom-full mb-2 z-50 max-w-sm w-max rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-700 dark:text-slate-200 shadow-lg whitespace-pre-wrap break-words">
          {reason}
          <div className="absolute left-4 top-full -mt-px w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-200 dark:border-t-slate-600" />
          <div className="absolute left-4 top-full -mt-[7px] w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-white dark:border-t-slate-800" />
        </div>
      )}
    </div>
  );
}

/** 时间单元格：显示相对时间，hover 显示精确时间 */
function TimeCell({ iso }: { iso: string | undefined | null }) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!iso) return <span>-</span>;

  const date = new Date(iso);
  const isValid = !isNaN(date.getTime());
  const precise = isValid
    ? date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '未知时间';

  return (
    <div className="relative inline-block">
      <span
        className="cursor-default"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {relativeTime(iso)}
      </span>
      {showTooltip && (
        <div className="absolute left-0 bottom-full mb-2 z-50 w-max rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-gray-700 dark:text-slate-200 shadow-lg whitespace-nowrap">
          {precise}
          <div className="absolute left-4 top-full -mt-px w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-200 dark:border-t-slate-600" />
          <div className="absolute left-4 top-full -mt-[7px] w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-white dark:border-t-slate-800" />
        </div>
      )}
    </div>
  );
}

// ─── Sort types ────────────────────────────────────────────────

type SortField = 'bannedAt' | 'hitCount';
type SortDirection = 'asc' | 'desc';

function SortIcon({ field, currentField, currentDir }: { field: SortField; currentField: SortField | null; currentDir: SortDirection }) {
  const isActive = field === currentField;
  return (
    <svg className={`inline-block ml-1 h-3.5 w-3.5 ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400 dark:text-slate-500'}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
      {isActive && currentDir === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      ) : isActive && currentDir === 'desc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
      )}
    </svg>
  );
}

// ─── Constants ──────────────────────────────────────────────────

const PAGE_SIZE = 10;

// ─── Main Component ─────────────────────────────────────────────

interface Props {
  bannedIps: BannedIP[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export default function BannedIpsTab({ bannedIps, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [unbanTarget, setUnbanTarget] = useState<string | null>(null);
  const [unbanning, setUnbanning] = useState(false);

  // Batch selection
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
  const [batchUnbanning, setBatchUnbanning] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page when data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [bannedIps.length]);

  // Reset selection when data changes
  useEffect(() => {
    setSelectedIps(new Set());
  }, [bannedIps]);

  // Sorted data
  const sortedIps = useMemo(() => {
    const items = [...bannedIps];
    if (!sortField) return items;

    return items.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'bannedAt') {
        const tA = a.bannedAt ? new Date(a.bannedAt).getTime() : 0;
        const tB = b.bannedAt ? new Date(b.bannedAt).getTime() : 0;
        cmp = tA - tB;
      } else if (sortField === 'hitCount') {
        cmp = a.hitCount - b.hitCount;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [bannedIps, sortField, sortDir]);

  // Paginated data
  const totalPages = Math.max(1, Math.ceil(sortedIps.length / PAGE_SIZE));
  const paginatedIps = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedIps.slice(start, start + PAGE_SIZE);
  }, [sortedIps, currentPage]);

  // ─── Handlers ──────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === 'desc') {
        setSortDir('asc');
      } else {
        setSortField(null);
      }
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setCurrentPage(1);
  };

  const toggleSelect = (ip: string) => {
    setSelectedIps((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIps.size === paginatedIps.length) {
      setSelectedIps(new Set());
    } else {
      setSelectedIps(new Set(paginatedIps.map((item) => item.ip)));
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIp.trim()) return;

    setAdding(true);
    try {
      const res = await api('POST', '/api/admin/banned-ips', {
        ip: newIp.trim(),
        reason: newReason.trim() || 'Manually banned',
      });
      if (res.ok) {
        toast('IP 已加入黑名单', 'success');
        setNewIp('');
        setNewReason('');
        setShowAddForm(false);
        await onRefresh();
      } else {
        toast(extractErrorMessage(res.data), 'error');
      }
    } catch {
      toast('操作失败', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleUnban = async () => {
    if (!unbanTarget) return;

    setUnbanning(true);
    try {
      const res = await api('DELETE', `/api/admin/banned-ips/${encodeURIComponent(unbanTarget)}`);
      if (res.ok) {
        toast('IP 已解除拉黑', 'success');
        await onRefresh();
      } else {
        toast(extractErrorMessage(res.data), 'error');
      }
    } catch {
      toast('操作失败', 'error');
    } finally {
      setUnbanning(false);
      setUnbanTarget(null);
    }
  };

  const handleBatchUnban = async () => {
    if (selectedIps.size === 0) return;

    setBatchUnbanning(true);
    try {
      const res = await api('POST', '/api/admin/banned-ips/batch-unban', {
        ips: Array.from(selectedIps),
      });
      if (res.ok) {
        toast(`已批量解除 ${selectedIps.size} 个 IP 的拉黑`, 'success');
        setSelectedIps(new Set());
        await onRefresh();
      } else {
        toast(extractErrorMessage(res.data), 'error');
      }
    } catch {
      toast('操作失败', 'error');
    } finally {
      setBatchUnbanning(false);
      setShowBatchConfirm(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">IP 黑名单</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            管理被拉黑的 IP 地址。异常请求超过阈值会被自动拉黑。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIps.size > 0 && (
            <button
              onClick={() => setShowBatchConfirm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              批量解除 ({selectedIps.size})
            </button>
          )}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            手动拉黑
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">IP 地址</label>
              <input
                type="text"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                placeholder="例如: 192.168.1.1"
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">原因（可选）</label>
              <input
                type="text"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="例如: 恶意扫描"
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={adding || !newIp.trim()}
              className="inline-flex items-center rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {adding ? '添加中...' : '确认拉黑'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="inline-flex items-center rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-600"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        {loading && bannedIps.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-slate-400">
            加载中...
          </div>
        ) : bannedIps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-gray-500 dark:text-slate-400">
            <svg className="h-12 w-12 text-gray-300 dark:text-slate-600 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            <p>暂无被拉黑的 IP</p>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">异常请求会被自动识别和拦截</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-750">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={paginatedIps.length > 0 && selectedIps.size === paginatedIps.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">IP 地址</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">原因</th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                      onClick={() => handleSort('bannedAt')}
                    >
                      拉黑时间
                      <SortIcon field="bannedAt" currentField={sortField} currentDir={sortDir} />
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                      onClick={() => handleSort('hitCount')}
                    >
                      命中次数
                      <SortIcon field="hitCount" currentField={sortField} currentDir={sortDir} />
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {paginatedIps.map((item) => (
                    <tr key={item.ip} className={`hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors ${selectedIps.has(item.ip) ? 'bg-brand-50 dark:bg-brand-950/20' : ''}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIps.has(item.ip)}
                          onChange={() => toggleSelect(item.ip)}
                          className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-900 dark:text-slate-100">
                        {item.ip}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
                        <ReasonCell reason={item.reason} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                        <TimeCell iso={item.bannedAt} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                        {item.hitCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          onClick={() => setUnbanTarget(item.ip)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                          </svg>
                          解除拉黑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  共 {sortedIps.length} 条，第 {currentPage}/{totalPages} 页
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    首页
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let page: number;
                    if (totalPages <= 5) {
                      page = i + 1;
                    } else if (currentPage <= 3) {
                      page = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      page = totalPages - 4 + i;
                    } else {
                      page = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          page === currentPage
                            ? 'bg-brand-600 text-white'
                            : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    末页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Unban confirmation modal */}
      {unbanTarget && (
        <ConfirmModal
          title="解除拉黑"
          confirmLabel="确认解除"
          loading={unbanning}
          onConfirm={handleUnban}
          onCancel={() => setUnbanTarget(null)}
        >
          确定要解除对 IP &ldquo;{unbanTarget}&rdquo; 的拉黑吗？解除后该 IP 将可以再次访问服务。
        </ConfirmModal>
      )}

      {/* Batch unban confirmation modal */}
      {showBatchConfirm && (
        <ConfirmModal
          title="批量解除拉黑"
          confirmLabel={`确认解除 ${selectedIps.size} 个`}
          loading={batchUnbanning}
          onConfirm={handleBatchUnban}
          onCancel={() => setShowBatchConfirm(false)}
        >
          确定要批量解除以下 {selectedIps.size} 个 IP 的拉黑吗？
          <div className="mt-2 max-h-32 overflow-y-auto rounded-md bg-gray-50 dark:bg-slate-700 p-2 text-xs font-mono">
            {Array.from(selectedIps).map((ip) => (
              <div key={ip} className="text-gray-700 dark:text-slate-300">{ip}</div>
            ))}
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
