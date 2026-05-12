import type { LogEntry } from '@/types';
import { cardClass } from '@/lib/styles';

const LEVEL_COLORS: Record<string, string> = {
  debug: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  critical: 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200',
};

export function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${LEVEL_COLORS[level] || LEVEL_COLORS.info}`}>
      {level.toUpperCase()}
    </span>
  );
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

export interface LogDetailModalProps {
  entry: LogEntry;
  onClose: () => void;
  onFilterKeyword: (v: string) => void;
  onFilterAccountId: (v: string) => void;
  onFilterApiKey: (v: string) => void;
  onFilterClientIp: (v: string) => void;
}

export default function LogDetailModal({ entry, onClose, onFilterKeyword, onFilterAccountId, onFilterApiKey, onFilterClientIp }: LogDetailModalProps) {
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
