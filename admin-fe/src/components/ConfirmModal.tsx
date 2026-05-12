import { type ReactNode } from 'react';
import { secondaryBtnClass } from '@/lib/styles';
import Spinner from './Spinner';
import BaseModal from './BaseModal';

interface ConfirmModalProps {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  confirmColor?: 'red' | 'brand';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  children,
  confirmLabel = '确认',
  confirmColor = 'red',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const btnColors =
    confirmColor === 'red'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-brand-600 hover:bg-brand-700';

  return (
    <BaseModal title={title} maxWidth="max-w-sm" onClose={onCancel}>
      <div className="text-sm text-gray-600 dark:text-slate-400">{children}</div>
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onCancel} className={secondaryBtnClass}>
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${btnColors}`}
        >
          {loading && <Spinner className="mr-1.5 inline h-4 w-4" />}
          {confirmLabel}
        </button>
      </div>
    </BaseModal>
  );
}
