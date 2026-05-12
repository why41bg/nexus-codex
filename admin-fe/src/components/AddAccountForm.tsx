import { useState } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, primaryBtnClass, secondaryBtnClass, cardClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAccountBootstrap } from '@/hooks/useAccountBootstrap';
import Spinner from './Spinner';

interface Props {
  onAdded: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AddAccountForm({ onAdded }: Props) {
  const { toast } = useToast();

  // Manual mode state
  const [codexHome, setCodexHome] = useState('');
  const [remark, setRemark] = useState('');
  const [maxConcurrency, setMaxConcurrency] = useState('');
  const [adding, setAdding] = useState(false);

  // Bootstrap mode
  const { state: bs, startBootstrap, confirmBootstrap, cancelBootstrap, reset } =
    useAccountBootstrap(onAdded);
  const [mode, setMode] = useState<'manual' | 'bootstrap'>('bootstrap');

  const handleManualAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!codexHome.trim()) return;
    setAdding(true);
    try {
      const res = await api('POST', '/api/admin/accounts', {
        codexHome: codexHome.trim(),
        remark: remark.trim(),
        ...(maxConcurrency && { maxConcurrency: Number(maxConcurrency) }),
      });
      if (res.ok) {
        toast('账号添加成功', 'success');
        setCodexHome('');
        setRemark('');
        setMaxConcurrency('');
        onAdded();
      } else {
        toast(extractErrorMessage(res.data, '添加失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleBootstrapStart = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await startBootstrap(remark, maxConcurrency);
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast(`${label}已复制`, 'success');
  };

  // ── Bootstrap: waiting UI ──
  if (bs.step === 'waiting' && bs.session) {
    return (
      <div className={`mt-6 ${cardClass} p-6`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            等待登录完成
          </h2>
          <span className="text-sm text-orange-600 dark:text-orange-400 font-mono">
            {formatTime(bs.remainingSeconds)}
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {/* Login URL */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              登录链接
            </label>
            <div className="flex gap-2">
              <a
                href={bs.session.loginUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`${inputClass} flex-1 text-xs text-brand-600 dark:text-brand-400 hover:underline truncate flex items-center`}
              >
                {bs.session.loginUrl ?? ''}
              </a>
              <button
                onClick={() =>
                  bs.session?.loginUrl && copyToClipboard(bs.session.loginUrl, '链接')
                }
                className={secondaryBtnClass}
              >
                复制
              </button>
            </div>
          </div>

          {/* Device Code */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              验证码
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={bs.session.deviceCode ?? ''}
                className={`${inputClass} flex-1 font-mono text-lg tracking-widest text-center`}
              />
              <button
                onClick={() =>
                  bs.session?.deviceCode &&
                  copyToClipboard(bs.session.deviceCode, '验证码')
                }
                className={secondaryBtnClass}
              >
                复制
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-slate-400">
            请在浏览器中打开上述链接，登录 OpenAI 账号后输入验证码。完成后系统将自动检测并注册账号。
          </p>

          <div className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400">
            <Spinner className="h-4 w-4" />
            等待登录中...
          </div>

          <button
            onClick={cancelBootstrap}
            className="text-sm text-gray-500 hover:text-red-500"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // ── Bootstrap: success UI ──
  if (bs.step === 'success' && bs.session) {
    return (
      <div
        className={`mt-6 ${cardClass} p-6 border-2 border-green-300 dark:border-green-700`}
      >
        <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">
          登录成功
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          账号目录：{bs.session.codexHome}
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={confirmBootstrap} className={primaryBtnClass}>
            确认注册
          </button>
          <button onClick={reset} className={secondaryBtnClass}>
            放弃
          </button>
        </div>
      </div>
    );
  }

  // ── Bootstrap: failed / timeout UI ──
  if ((bs.step === 'failed' || bs.step === 'timeout') && bs.error) {
    return (
      <div
        className={`mt-6 ${cardClass} p-6 border-2 border-red-300 dark:border-red-700`}
      >
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
          {bs.step === 'timeout' ? '登录超时' : '登录失败'}
        </h2>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{bs.error}</p>
        <button onClick={reset} className={`mt-4 ${secondaryBtnClass}`}>
          重试
        </button>
      </div>
    );
  }

  // ── Default: form UI ──
  return (
    <div className={`mt-6 ${cardClass} p-6`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          添加账号
        </h2>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setMode('bootstrap')}
            className={`px-2 py-1 rounded ${
              mode === 'bootstrap'
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300'
                : 'text-gray-500'
            }`}
          >
            引导创建
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`px-2 py-1 rounded ${
              mode === 'manual'
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300'
                : 'text-gray-500'
            }`}
          >
            手动添加
          </button>
        </div>
      </div>

      {mode === 'manual' ? (
        <form
          onSubmit={handleManualAdd}
          className="mt-4 flex flex-col gap-3 md:flex-row md:items-end"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              CODEX_HOME 路径 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={codexHome}
              onChange={(e) => setCodexHome(e.target.value)}
              placeholder="/Users/you/.codex-pool/account-x"
              className={inputClass}
            />
          </div>
          <div className="md:w-56">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              备注
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="email@example.com"
              className={inputClass}
            />
          </div>
          <div className="md:w-28">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              最大并发
            </label>
            <input
              type="number"
              min="1"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              placeholder="默认"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={!codexHome.trim() || adding}
            className={primaryBtnClass}
          >
            {adding && <Spinner className="mr-1.5 h-4 w-4" />}
            添加
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleBootstrapStart}
          className="mt-4 flex flex-col gap-3 md:flex-row md:items-end"
        >
          <div className="md:w-56">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              备注
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="email@example.com"
              className={inputClass}
            />
          </div>
          <div className="md:w-28">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              最大并发
            </label>
            <input
              type="number"
              min="1"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              placeholder="默认"
              className={inputClass}
            />
          </div>
          <button type="submit" className={primaryBtnClass}>
            创建并登录
          </button>
        </form>
      )}
    </div>
  );
}