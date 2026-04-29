import { type ReactNode, useEffect, useId, useRef } from 'react';
import { secondaryBtnClass } from '@/lib/styles';
import Spinner from './Spinner';
import { useFocusTrap } from '../lib/use-focus-trap';

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
  confirmLabel = '\u786e\u8ba4',
  confirmColor = 'red',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const btnColors =
    confirmColor === 'red'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-brand-600 hover:bg-brand-700';

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

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
        <div className="mt-2 text-sm text-gray-600 dark:text-slate-400">{children}</div>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancel} className={secondaryBtnClass}>
            \u53d6\u6d88
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
      </div>
    </div>
  );
}
