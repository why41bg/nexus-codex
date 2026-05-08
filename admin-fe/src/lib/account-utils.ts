import type { Account } from '@/types';

/** 根据账号状态返回对应的样式类名和文字标签 */
export function getAccountStatus(acc: Account): { dot: string; text: string; label: string } {
  if (!acc.enabled) return { dot: 'bg-gray-400', text: 'text-gray-400', label: '已禁用' };
  if (!acc.runtime?.healthy) return { dot: 'bg-red-500', text: 'text-red-600', label: '不健康' };
  const active = acc.runtime?.activeCount ?? 0;
  const max = acc.runtime?.maxConcurrency ?? 0;
  if (active >= max) return { dot: 'bg-amber-400', text: 'text-amber-600', label: '满载' };
  if (active > 0) return { dot: 'bg-blue-400', text: 'text-blue-600', label: '部分占用' };
  return { dot: 'bg-green-500', text: 'text-green-600', label: '空闲' };
}

/** 将 Unix 时间戳（秒）格式化为剩余时间字符串 */
export function formatResetsIn(resetsAt: number): string {
  const diffMs = resetsAt * 1000 - Date.now();
  if (diffMs <= 0) return '已重置';
  const totalMins = Math.floor(diffMs / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

/** 额度进度条颜色（基于剩余额度百分比） */
export function quotaBarColor(remainingPct: number): string {
  if (remainingPct <= 10) return 'bg-red-500';
  if (remainingPct <= 40) return 'bg-amber-400';
  return 'bg-green-500';
}
