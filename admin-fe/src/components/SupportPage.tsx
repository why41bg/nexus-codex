import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

export default function SupportPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-gray-50 dark:bg-slate-900">
      <ThemeToggle />

      {/* Header */}
      <header className="flex flex-col items-center px-6 pt-20 pb-12 text-center">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          返回首页
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-slate-100 sm:text-4xl">
          共享入池
        </h1>
        <p className="mt-4 max-w-md text-base text-gray-500 dark:text-slate-400">
          了解账号池的运作方式，以及如何将你的闲置账号加入共享。
        </p>
      </header>

      {/* Content */}
      <section className="mx-auto w-full max-w-2xl px-6 pb-20">
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-sm ring-1 ring-gray-200 dark:ring-slate-700">
          <div className="mb-8 rounded-xl border border-brand-100 bg-brand-50/70 px-5 py-4 dark:border-brand-900/40 dark:bg-brand-950/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
                  发起共享
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                  持有邀请码即可发起共享，提交后将由管理员审核入池。
                </p>
              </div>
              <Link
                to="/contribute"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
              >
                开始共享
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </div>

          {/* 什么是账号池 */}
          <div className="mb-8">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950 text-sm">📦</span>
              什么是账号池
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-slate-300">
              Nexus Codex 账号池将多个 OpenAI 账号统一管理，通过负载均衡策略自动选择可用账号进行 API 调用，
              有效分散用量、避免单账号过载、提升整体可用性。
            </p>
          </div>

          {/* 入池申请流程 */}
          <div className="mb-8">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950 text-sm">📋</span>
              入池申请流程
            </h2>
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                🚧 该功能正在建设中，具体流程待确定。
              </p>
            </div>
          </div>

          {/* 联系管理员 */}
          <div className="mb-8">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950 text-sm">💬</span>
              联系管理员
            </h2>
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                🚧 联系方式待补充，请关注后续更新。
              </p>
            </div>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950 text-sm">❓</span>
              常见问题
            </h2>
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                🚧 FAQ 内容正在整理中。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-200 dark:border-slate-700 py-6 text-center text-sm text-gray-400 dark:text-slate-500">
        Nexus Codex &copy; {new Date().getFullYear()} — OpenAI API Compatible Account Pool Gateway
      </footer>
    </div>
  );
}
