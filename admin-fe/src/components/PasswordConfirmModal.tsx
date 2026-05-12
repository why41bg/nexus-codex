import { useState, useEffect, useRef } from 'react';
import { inputClass, secondaryBtnClass } from '@/lib/styles';
import Spinner from './Spinner';
import BaseModal from './BaseModal';

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    onConfirm(password);
  };

  return (
    <BaseModal title={title} description={description} maxWidth="max-w-sm" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
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
    </BaseModal>
  );
}
