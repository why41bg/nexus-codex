import { useState, useMemo } from 'react';
import type { Account } from '@/types';
import { relativeTime } from '@/lib/time';
import { api, extractErrorMessage } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
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
                <th className="px-4 py-3 font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 font-medium text-gray-500">ID</th>
                <th className="px-4 py-3 font-medium text-gray-500">备注</th>
                <th className="px-4 py-3 font-medium text-gray-500">并发</th>
                <th className="px-4 py-3 font-medium text-gray-500">CODEX_HOME</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">使用次数</th>
                <th className="px-4 py-3 font-medium text-gray-500">最后使用</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((acc) => (
                <tr key={acc.id} className="transition-colors hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    {(() => { const s = getAccountStatus(acc); return (<><span className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot}`} /><span className={`ml-1.5 text-xs ${s.text}`}>{s.label}</span></>); })()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{acc.id}</td>
                  <td className="px-4 py-3 text-gray-700">{acc.remark || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-gray-700">
                    {acc.runtime ? `${acc.runtime.activeCount} / ${acc.runtime.maxConcurrency}` : '—'}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-500" title={acc.codexHome}>
                    {acc.codexHome}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{acc.usageCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{relativeTime(acc.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleEnabled(acc)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          acc.enabled
                            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'bg-green-50 text-green-700 hover:bg-green-100'
                        }`}
                      >
                        {acc.enabled ? '禁用' : '启用'}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(acc)}
                        className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
