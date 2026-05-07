import { useState } from 'react';
import type { BannedIP } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { relativeTime } from '@/lib/time';
import ConfirmModal from './ConfirmModal';

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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-750">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">IP 地址</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">原因</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">拉黑时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">命中次数</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {bannedIps.map((item) => (
                  <tr key={item.ip} className="hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-900 dark:text-slate-100">
                      {item.ip}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400 max-w-xs truncate" title={item.reason}>
                      {item.reason}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                      {item.bannedAt ? relativeTime(item.bannedAt) : '-'}
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
    </div>
  );
}
