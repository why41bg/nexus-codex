import { useState, useEffect, useId, useRef } from 'react';
import { inputClass, secondaryBtnClass } from '@/lib/styles';
import Spinner from './Spinner';
import { useFocusTrap } from '../lib/use-focus-trap';

interface PasswordConfirmModalProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export default function PasswordConfirmModal({
  title,
  description,
  confirmLabel = '确认',
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: PasswordConfirmModalProps) {
  const [password, setPassword] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    // Auto focus the password input
    inputRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    onConfirm(password);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="mx-4 w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none"
      >
        <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
        {description && (
          <p className="mt-1.5 text-sm text-gray-500 dark:text-slate-400">{description}</p>
        )}

        <form onSubmit={handleSubmit} className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-slate-400">
            管理员密码
          </label>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入管理员密码"
            className={inputClass}
            autoComplete="current-password"
          />

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={onCancel} className={secondaryBtnClass}>
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {loading && <Spinner className="mr-1.5 inline h-4 w-4" />}
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
