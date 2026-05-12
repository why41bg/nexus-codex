import { useCallback, useEffect, useState } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { cardClass, inputClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import Spinner from './Spinner';

interface SettingsData {
  codexCliPath: string;
  nodePath: string;
}

export default function SettingsTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [codexCliPath, setCodexCliPath] = useState('');
  const [nodePath, setNodePath] = useState('');
  const [originalPath, setOriginalPath] = useState('');
  const [originalNodePath, setOriginalNodePath] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<SettingsData>('GET', '/api/admin/settings');
      if (res.ok) {
        setCodexCliPath(res.data.codexCliPath || '');
        setNodePath(res.data.nodePath || '');
        setOriginalPath(res.data.codexCliPath || '');
        setOriginalNodePath(res.data.nodePath || '');
      } else {
        toast(extractErrorMessage(res.data, '获取设置失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!hasChanges) {
      toast('没有需要保存的修改', 'success');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ updated: Record<string, string> }>('PATCH', '/api/admin/settings', {
        codexCliPath: codexCliPath.trim(),
        nodePath: nodePath.trim(),
      });
      if (res.ok) {
        toast('设置已保存', 'success');
        setOriginalPath(codexCliPath.trim());
        setOriginalNodePath(nodePath.trim());
      } else {
        toast(extractErrorMessage(res.data, '保存失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = codexCliPath !== originalPath || nodePath !== originalNodePath;

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

      {/* Node Path */}
      <div className="mt-6">
        <label htmlFor="node-path" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
          Node.js 路径
        </label>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Node 可执行文件或 bin 目录路径。账号 Bootstrap 时会把该目录加入子进程 PATH，解决服务环境找不到 <code className="rounded bg-gray-100 dark:bg-slate-700 px-1 py-0.5 font-mono text-xs">node</code> 的问题。
        </p>
        <div className="mt-2 flex gap-3">
          <input
            id="node-path"
            type="text"
            className={`${inputClass} flex-1 font-mono`}
            placeholder="/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node"
            value={nodePath}
            onChange={(e) => setNodePath(e.target.value)}
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
            onClick={() => {
              setCodexCliPath(originalPath);
              setNodePath(originalNodePath);
            }}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            取消修改
          </button>
        )}
      </div>
    </div>
  );
}
