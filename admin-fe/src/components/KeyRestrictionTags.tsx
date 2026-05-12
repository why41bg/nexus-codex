import type { ApiKey } from '@/types';
import { relativeTime } from '@/lib/time';

export default function KeyRestrictionTags({ apiKey }: { apiKey: ApiKey }) {
  const tags: Array<{ label: string; color: string }> = [];

  if (apiKey.expiresAt) {
    const expired = new Date(apiKey.expiresAt) <= new Date();
    if (expired) {
      tags.push({ label: '已过期', color: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-400 dark:ring-red-800' });
    } else {
      tags.push({ label: `${relativeTime(apiKey.expiresAt)} 过期`, color: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:ring-orange-800' });
    }
  }

  if (apiKey.rateLimitMax != null) {
    const windowSec = (apiKey.rateLimitWindowMs ?? 60000) / 1000;
    const unit = windowSec >= 60 ? `${windowSec / 60}min` : `${windowSec}s`;
    tags.push({ label: `${apiKey.rateLimitMax} req/${unit}`, color: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:ring-purple-800' });
  }

  if (apiKey.monthlyQuota != null) {
    const usage = apiKey.monthlyUsage ?? 0;
    tags.push({ label: `${usage.toLocaleString()} / ${apiKey.monthlyQuota.toLocaleString()} 次/月`, color: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950 dark:text-cyan-400 dark:ring-cyan-800' });
  }

  if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
    tags.push({ label: `${apiKey.ipWhitelist.length} 个 IP`, color: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-400 dark:ring-green-800' });
  }

  if (tags.length === 0) {
    return <span className="rounded px-2 py-0.5 text-xs text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-700 ring-1 ring-gray-200 dark:ring-slate-600">无额外限制</span>;
  }

  return (
    <>
      {tags.map((tag, i) => (
        <span key={i} className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${tag.color}`}>
          {tag.label}
        </span>
      ))}
    </>
  );
}
