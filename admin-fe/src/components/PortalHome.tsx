import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { API_BASE } from '@/lib/api';
import type { SystemStatus } from '@/types';

const GUIDE_URL = 'https://why41bg.github.io/nexus-codex/';

interface CardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}

function FeatureCard({ icon, title, description, action }: CardProps) {
  return (
    <div className="flex flex-col rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-sm ring-1 ring-gray-200 dark:ring-slate-700 transition-shadow hover:shadow-md">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500 dark:text-slate-400">{description}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const modeOrder: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
  const modeIcons = { system: '💻', light: '☀️', dark: '🌙' };

  const cycleMode = () => {
    const idx = modeOrder.indexOf(mode);
    setMode(modeOrder[(idx + 1) % modeOrder.length]);
  };

  return (
    <button
      onClick={cycleMode}
      className="absolute top-6 right-6 flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
      title={`当前主题：${mode}`}
    >
      <span className="text-lg">{modeIcons[mode]}</span>
    </button>
  );
}

function SystemStatusBanner() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/system-status`)
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => {});
  }, []);

  if (!status) return null;

  const config = {
    green: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500', label: '系统正常' },
    yellow: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500', label: '部分受限' },
    red: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500', label: '服务不可用' },
  }[status.level];

  return (
    <div className={`mx-auto mt-6 flex max-w-lg items-center gap-3 rounded-xl px-5 py-3 ${config.bg}`}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.dot} animate-pulse`} />
      <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
      <span className={`ml-auto text-xs ${config.text} opacity-75`}>
        {status.healthyAccounts}/{status.totalAccounts} 账号健康 · {status.availableSlots}/{status.totalSlots} 可用槽位
      </span>
    </div>
  );
}

export default function PortalHome() {
  return (
    <div className="relative flex min-h-screen flex-col bg-gray-50 dark:bg-slate-900">
      <ThemeToggle />

      {/* Hero */}
      <header className="flex flex-col items-center px-6 pt-20 pb-12 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 text-3xl shadow-lg">
          ⚡
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-slate-100 sm:text-5xl">
          Nexus Codex
        </h1>
        <p className="mt-4 max-w-lg text-lg text-gray-500 dark:text-slate-400">
          OpenAI API 兼容的多账号池网关，统一管理、负载均衡、健康探测。
        </p>
        <SystemStatusBanner />
      </header>

      {/* Feature Cards */}
      <section className="mx-auto grid w-full max-w-5xl gap-6 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {/* Guide */}
        <FeatureCard
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          }
          title="使用指南"
          description="客户端配置文档，帮助你快速接入 Codex CLI、opencode 等工具。"
          action={
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              查看文档
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          }
        />

        {/* Support */}
        <FeatureCard
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
          }
          title="入池支持"
          description="了解账号池的入池方式和申请流程，加入共享账号资源。"
          action={
            <Link
              to="/support"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              了解详情
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          }
        />

        {/* Claim Key */}
        <FeatureCard
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 1 1 3 3m-3-3a3 3 0 0 0-3 3m3-3h3m-6 3a3 3 0 0 1 3-3m-3 3H4.5m8.25 0h3.75m-3.75 0a3 3 0 0 0 3 3m0 0a3 3 0 1 1-3 3m3-3H4.5m8.25 3H8.25" />
            </svg>
          }
          title="申领 API Key"
          description="通过管理员配置的模板自助生成 API Key，获得对应模型访问权限。"
          action={
            <Link
              to="/claim"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              立即申领
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          }
        />

        {/* Admin Panel */}
        <FeatureCard
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
          }
          title="控制面板"
          description="管理账号池、API Key、查看监控大盘和系统状态。需要管理员身份登录。"
          action={
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              进入面板
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </Link>
          }
        />
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-200 dark:border-slate-700 py-6 text-center text-sm text-gray-400 dark:text-slate-500">
        Nexus Codex &copy; {new Date().getFullYear()} — OpenAI API Compatible Account Pool Gateway
      </footer>
    </div>
  );
}
