/**
 * 相对时间格式化
 */
export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return '从未使用';
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return '未知时间';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}
