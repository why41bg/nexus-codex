interface TopBarProps {
  connected: boolean;
  loading: boolean;
  onRefresh: () => void;
}

export default function TopBar({ connected, loading, onRefresh }: TopBarProps) {
  return (
    <div className="mb-6 hidden items-center justify-end gap-2 md:flex">
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-500 dark:text-slate-400">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-300 dark:bg-slate-500'}`} />
        {connected ? '实时' : '已断开'}
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
      >
        <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
        </svg>
        刷新
      </button>
    </div>
  );
}
