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

/** 管理台小号操作按钮 */
export const subtleBtnClass =
  'rounded-md bg-gray-50 dark:bg-slate-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 transition-colors hover:bg-gray-100 dark:hover:bg-slate-600';

/** 纯图标按钮 */
export const iconButtonClass =
  'rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300';

/** 空状态占位（虚线边框） */
export const dashedEmptyStateClass =
  'rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-400 dark:border-slate-600 dark:text-slate-500';

/** 图表空状态占位 */
export const chartEmptyStateClass =
  'flex h-48 items-center justify-center text-sm text-gray-400 dark:text-slate-500';

/** 管理台品牌色小号操作按钮 */
export const brandSubtleBtnClass =
  'rounded-md bg-brand-50 dark:bg-brand-950 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-900';

/** 危险操作小号按钮 */
export const dangerSubtleBtnClass =
  'rounded-md bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900';

/** 警告操作小号按钮 */
export const warningSubtleBtnClass =
  'rounded-md bg-amber-50 dark:bg-amber-950 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900';

/** 成功态小号按钮 */
export const successSubtleBtnClass =
  'rounded-md bg-green-50 dark:bg-green-950 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 transition-colors hover:bg-green-100 dark:hover:bg-green-900';

/** 启停状态徽标 */
export const enabledStatusBadgeClass = (enabled: boolean) =>
  `rounded px-2 py-0.5 text-xs ${
    enabled
      ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400'
      : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
  }`;

/** 管理台筛选按钮容器 */
export const filterTabsWrapClass =
  'mt-4 flex gap-1 rounded-lg bg-gray-100 dark:bg-slate-800 p-1 w-fit';

/** 管理台筛选按钮 */
export const filterTabBtnClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
    active
      ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm'
      : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
  }`;
