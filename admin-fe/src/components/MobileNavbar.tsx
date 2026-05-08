import Spinner from './Spinner';

interface MobileNavbarProps {
  connected: boolean;
  loading: boolean;
  onRefresh: () => void;
  onMenuClick: () => void;
}

export default function MobileNavbar({ connected, loading, onRefresh, onMenuClick }: MobileNavbarProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between h-14 px-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 md:hidden">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-1.5 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <h1 className="text-base font-bold tracking-tight text-gray-900 dark:text-slate-100">Nexus Codex</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs text-gray-500 dark:text-slate-400">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-300 dark:bg-slate-500'}`} />
          {connected ? '实时' : '已断开'}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
        >
          {loading ? <Spinner className="h-3.5 w-3.5" /> : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
          )}
          刷新
        </button>
      </div>
    </div>
  );
}
