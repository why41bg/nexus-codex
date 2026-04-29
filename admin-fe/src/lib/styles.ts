/**
 * 公共 Tailwind 样式类名常量，消除各组件中的重复字符串。
 * 所有常量均已包含 dark: variants。
 */

/** 标准文本输入框 */
export const inputClass =
  'block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

/** 主要操作按钮（品牌色） */
export const primaryBtnClass =
  'inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50';

/** 白色卡片/面板 */
export const cardClass =
  'rounded-xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-gray-200 dark:ring-slate-700';

/** 次级按钮（白底 + 灰框） */
export const secondaryBtnClass =
  'rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600';
