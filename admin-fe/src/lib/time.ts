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

/** 将毫秒转换为友好的时间显示 */
export function formatDuration(ms: number): string {
  if (ms >= 86400000) {
    const days = ms / 86400000;
    return days === 1 ? '1 天' : `${days} 天`;
  }
  if (ms >= 3600000) {
    const hours = ms / 3600000;
    return hours === 1 ? '1 小时' : `${hours} 小时`;
  }
  const minutes = ms / 60000;
  return minutes === 1 ? '1 分钟' : `${minutes} 分钟`;
}

/** 将时间戳格式化为 HH:mm */
export function formatClockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 保留指定小数位 */
export function roundTo(n: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** 预设的时间窗口选项 */
export const WINDOW_PRESETS = [
  { label: '1 小时', value: '3600000' },
  { label: '6 小时', value: '21600000' },
  { label: '12 小时', value: '43200000' },
  { label: '24 小时', value: '86400000' },
  { label: '7 天', value: '604800000' },
] as const;

/** 生成随机码（用于邀请码/申领码）*/
export function generateRandomCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
