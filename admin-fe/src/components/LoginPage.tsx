import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { inputClass } from '@/lib/styles';
import { useAuth } from '@/contexts/AuthContext';
import Spinner from './Spinner';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    const err = await login(username, password);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-gray-50 dark:bg-slate-900">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-slate-700">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">Nexus Codex</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">登录管理面板</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">密码</label>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50"
          >
            {loading && <Spinner className="mr-2 h-4 w-4" />}
            登录
          </button>
        </form>

        <div className="text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            回到门户首页
          </Link>
        </div>
      </div>
    </div>
  );
}
