import { useCallback, useEffect, useState } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { useAuthGuard } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import Spinner from './Spinner';

const cardClass = 'rounded-2xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-gray-200 dark:ring-slate-700';
const inputClass =
  'block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

interface SettingsData {
  codexCliPath: string;
}

export default function SettingsTab() {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [codexCliPath, setCodexCliPath] = useState('');
  const [originalPath, setOriginalPath] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<SettingsData>('GET', '/api/admin/settings');
      if (authGuard(res.status)) return;
      if (res.ok) {
        setCodexCliPath(res.data.codexCliPath || '');
        setOriginalPath(res.data.codexCliPath || '');
      } else {
        toast(extractErrorMessage(res.data, '获取设置失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [authGuard, toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (codexCliPath === originalPath) {
      toast('没有需要保存的修改', 'success');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ updated: Record<string, string> }>('PATCH', '/api/admin/settings', {
        codexCliPath: codexCliPath.trim(),
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('设置已保存', 'success');
        setOriginalPath(codexCliPath.trim());
      } else {
        toast(extractErrorMessage(res.data, '保存失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = codexCliPath !== originalPath;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-5 w-5 text-brand-600" />
        <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
      </div>
    );
  }

  return (
    <div className={`mt-8 ${cardClass} p-6`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">系统设置</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        配置系统运行时参数。修改会即时生效并持久化保存，无需重启服务。
      </p>

      {/* Codex CLI Path */}
      <div className="mt-6">
        <label htmlFor="codex-cli-path" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
          Codex CLI 路径
        </label>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Codex 命令行工具的绝对路径。用于账号 Bootstrap 流程中调用 <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono text-xs">codex login --device-auth</code>。
          留空或填 <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono text-xs">codex</code> 则使用系统 PATH 查找。
        </p>
        <div className="mt-2 flex gap-3">
          <input
            id="codex-cli-path"
            type="text"
            className={`${inputClass} flex-1 font-mono`}
            placeholder="codex 或 /home/ubuntu/.nvm/versions/node/v20.20.2/bin/codex"
            value={codexCliPath}
            onChange={(e) => setCodexCliPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hasChanges) handleSave(); }}
          />
        </div>
      </div>

      {/* Save Button */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Spinner className="h-4 w-4 text-white" />}
          保存设置
        </button>
        {hasChanges && (
          <button
            onClick={() => setCodexCliPath(originalPath)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            取消修改
          </button>
        )}
      </div>
    </div>
  );
}
