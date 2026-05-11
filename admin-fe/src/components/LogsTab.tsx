import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, LogQueryResult } from '@/types';
import { api } from '@/lib/api';
import { useAuthGuard } from '@/contexts/AuthContext';
import { cardClass, inputClass, secondaryBtnClass } from '@/lib/styles';

const LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;
const LEVEL_COLORS: Record<string, string> = {
  debug: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  critical: 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200',
};

const TIME_RANGES = [
  { label: '最近 1 小时', value: '1h', ms: 3600_000 },
  { label: '最近 6 小时', value: '6h', ms: 21600_000 },
  { label: '最近 24 小时', value: '24h', ms: 86400_000 },
  { label: '最近 7 天', value: '7d', ms: 604800_000 },
  { label: '全部', value: '', ms: 0 },
] as const;

const EVENT_TYPES = [
  { label: '全部事件', value: '' },
  { label: '请求完成', value: 'request_complete' },
  { label: '请求错误', value: 'request_error' },
  { label: '上游错误', value: 'upstream_error' },
  { label: '上游超时', value: 'upstream_timeout' },
  { label: '认证失败', value: 'auth_failure' },
  { label: '登录失败', value: 'login_failure' },
  { label: '速率限制', value: 'rate_limit_hit' },
  { label: '配额超限', value: 'quota_exceeded' },
  { label: 'IP 封禁', value: 'ip_auto_banned' },
  { label: '账号池耗尽', value: 'all_accounts_exhausted' },
  { label: '健康检查失败', value: 'health_check_fail' },
  { label: 'Token 过期', value: 'token_expired' },
  { label: '未处理异常', value: 'unhandled_exception' },
] as const;

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${LEVEL_COLORS[level] || LEVEL_COLORS.info}`}>
      {level.toUpperCase()}
    </span>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Clickable filter link used in the detail modal */
function FilterLink({ label, value, onClick }: { label: string; value: string; onClick: (v: string) => void }) {
  return (
    <button
      onClick={() => onClick(value)}
      className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
      title={`筛选: ${label} = ${value}`}
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
      </svg>
      筛选
    </button>
  );
}

interface LogDetailModalProps {
  entry: LogEntry;
  onClose: () => void;
  onFilterKeyword: (v: string) => void;
  onFilterAccountId: (v: string) => void;
  onFilterApiKey: (v: string) => void;
  onFilterClientIp: (v: string) => void;
}

function LogDetailModal({ entry, onClose, onFilterKeyword, onFilterAccountId, onFilterApiKey, onFilterClientIp }: LogDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`${cardClass} max-h-[80vh] w-full max-w-2xl overflow-y-auto p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">日志详情</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500 dark:text-slate-400">ID</dt>
            <dd className="font-mono text-gray-900 dark:text-slate-100">{entry.id}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-slate-400">时间</dt>
            <dd className="text-gray-900 dark:text-slate-100">{new Date(entry.timestamp).toLocaleString('zh-CN')}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-slate-400">级别</dt>
            <dd><LevelBadge level={entry.level} /></dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-slate-400">来源</dt>
            <dd className="font-mono text-gray-900 dark:text-slate-100">{entry.source}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-slate-400">事件</dt>
            <dd className="font-mono text-gray-900 dark:text-slate-100">{entry.event}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-slate-400">耗时</dt>
            <dd className="text-gray-900 dark:text-slate-100">{entry.duration_ms != null ? `${entry.duration_ms}ms` : '-'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-gray-500 dark:text-slate-400">消息</dt>
            <dd className="text-gray-900 dark:text-slate-100">{entry.message}</dd>
          </div>
          {entry.trace_id && (
            <div>
              <dt className="text-gray-500 dark:text-slate-400">Trace ID</dt>
              <dd className="font-mono text-xs text-gray-900 dark:text-slate-100">
                {entry.trace_id}
                <FilterLink label="Trace ID" value={entry.trace_id} onClick={(v) => { onFilterKeyword(v); onClose(); }} />
              </dd>
            </div>
          )}
          {entry.account_id && (
            <div>
              <dt className="text-gray-500 dark:text-slate-400">账号 ID</dt>
              <dd className="font-mono text-xs text-gray-900 dark:text-slate-100">
                {entry.account_id}
                <FilterLink label="账号 ID" value={entry.account_id} onClick={(v) => { onFilterAccountId(v); onClose(); }} />
              </dd>
            </div>
          )}
          {entry.api_key_id && (
            <div>
              <dt className="text-gray-500 dark:text-slate-400">API Key</dt>
              <dd className="font-mono text-xs text-gray-900 dark:text-slate-100">
                {entry.api_key_id}
                <FilterLink label="API Key" value={entry.api_key_id} onClick={(v) => { onFilterApiKey(v); onClose(); }} />
              </dd>
            </div>
          )}
          {entry.client_ip && (
            <div>
              <dt className="text-gray-500 dark:text-slate-400">客户端 IP</dt>
              <dd className="font-mono text-xs text-gray-900 dark:text-slate-100">
                {entry.client_ip}
                <FilterLink label="IP" value={entry.client_ip} onClick={(v) => { onFilterClientIp(v); onClose(); }} />
              </dd>
            </div>
          )}
          {entry.tags.length > 0 && (
            <div className="col-span-2">
              <dt className="text-gray-500 dark:text-slate-400">标签</dt>
              <dd className="flex flex-wrap gap-1 pt-1">
                {entry.tags.map((t) => (
                  <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                    {t}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {entry.context && Object.keys(entry.context).length > 0 && (
            <div className="col-span-2">
              <dt className="text-gray-500 dark:text-slate-400">上下文 (JSON)</dt>
              <dd className="mt-1 overflow-x-auto rounded bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:bg-slate-900 dark:text-slate-200">
                <pre>{JSON.stringify(entry.context, null, 2)}</pre>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

export default function LogsTab() {
  const authGuard = useAuthGuard();
  const authGuardRef = useRef(authGuard);
  authGuardRef.current = authGuard;

  const [items, setItems] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);

  // Filters
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [event, setEvent] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [accountId, setAccountId] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [clientIp, setClientIp] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Trigger counter: incremented to force a re-fetch (on initial mount + manual query + page change)
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const triggerSearch = useCallback(() => {
    setPage(0);
    setFetchTrigger((n) => n + 1);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set('keyword', keyword);
      if (level) params.set('level', level);
      if (source) params.set('source', source);
      if (event) params.set('event', event);
      if (accountId) params.set('account_id', accountId);
      if (apiKeyId) params.set('api_key_id', apiKeyId);
      if (clientIp) params.set('client_ip', clientIp);

      // Time range
      const rangeEntry = TIME_RANGES.find((r) => r.value === timeRange);
      if (rangeEntry && rangeEntry.ms > 0) {
        params.set('since', String(Date.now() - rangeEntry.ms));
      }

      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      params.set('order', 'desc');

      const res = await api<LogQueryResult>('GET', `/api/admin/logs?${params.toString()}`);
      if (authGuardRef.current(res.status)) return;
      if (res.ok && res.data) {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      // Network error — clear results so the user sees something changed
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Active filter chips (for secondary filters like account_id, api_key_id, client_ip)
  const activeChips: { label: string; clear: () => void }[] = [];
  if (accountId) activeChips.push({ label: `账号: ${accountId}`, clear: () => { setAccountId(''); triggerSearch(); } });
  if (apiKeyId) activeChips.push({ label: `API Key: ${apiKeyId}`, clear: () => { setApiKeyId(''); triggerSearch(); } });
  if (clientIp) activeChips.push({ label: `IP: ${clientIp}`, clear: () => { setClientIp(''); triggerSearch(); } });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">系统日志</h2>

      {/* Filters */}
      <div className={`${cardClass} p-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">关键词</label>
            <input
              type="text"
              placeholder="搜索消息内容..."
              className={inputClass}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') triggerSearch(); }}
            />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">级别</label>
            <select
              className={inputClass}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">全部</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">事件类型</label>
            <select
              className={inputClass}
              value={event}
              onChange={(e) => setEvent(e.target.value)}
            >
              {EVENT_TYPES.map((ev) => (
                <option key={ev.value} value={ev.value}>{ev.label}</option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">时间范围</label>
            <select
              className={inputClass}
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
            >
              {TIME_RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">来源</label>
            <input
              type="text"
              placeholder="e.g. middleware.access"
              className={inputClass}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <button
            onClick={triggerSearch}
            className={secondaryBtnClass}
          >
            查询
          </button>
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              >
                {chip.label}
                <button
                  onClick={chip.clear}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800/50"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            <button
              onClick={() => {
                setAccountId('');
                setApiKeyId('');
                setClientIp('');
                triggerSearch();
              }}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              清除全部
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className={`${cardClass} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">时间</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">级别</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">来源</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">事件</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">账号</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">消息</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-500 dark:text-slate-400">耗时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400 dark:text-slate-500">加载中...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400 dark:text-slate-500">暂无日志数据</td>
                </tr>
              ) : (
                items.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300 font-mono text-xs">
                      {formatTime(entry.timestamp)}
                    </td>
                    <td className="px-3 py-2">
                      <LevelBadge level={entry.level} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600 dark:text-slate-300">
                      {entry.source}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600 dark:text-slate-300">
                      {entry.event}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400" title={entry.account_id || ''}>
                      {entry.account_id ? (entry.account_id.length > 12 ? entry.account_id.slice(0, 12) + '…' : entry.account_id) : '-'}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-gray-900 dark:text-slate-100">
                      {entry.message}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">
                      {entry.duration_ms != null ? `${entry.duration_ms}ms` : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-700 px-4 py-3">
            <span className="text-xs text-gray-500 dark:text-slate-400">
              共 {total} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className={`${secondaryBtnClass} px-3 py-1 text-xs disabled:opacity-40`}
              >
                上一页
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className={`${secondaryBtnClass} px-3 py-1 text-xs disabled:opacity-40`}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedEntry && (
        <LogDetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onFilterKeyword={(v) => { setKeyword(v); triggerSearch(); }}
          onFilterAccountId={(v) => { setAccountId(v); triggerSearch(); }}
          onFilterApiKey={(v) => { setApiKeyId(v); triggerSearch(); }}
          onFilterClientIp={(v) => { setClientIp(v); triggerSearch(); }}
        />
      )}
    </div>
  );
}
