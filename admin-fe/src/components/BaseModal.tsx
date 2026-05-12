import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../lib/use-focus-trap';

interface BaseModalProps {
  /** Modal 标题 */
  title: string;
  /** 可选副标题/描述 */
  description?: string;
  /** 最大宽度 class，默认 max-w-lg */
  maxWidth?: string;
  /** 关闭回调 */
  onClose: () => void;
  /** Modal 内容 */
  children: ReactNode;
}

/**
 * 通用 Modal 骨架组件。
 * 提供统一的：overlay + 居中容器 + focus trap + Escape 关闭 + 点击遮罩关闭 + ARIA 属性。
 */
export default function BaseModal({
  title,
  description,
  maxWidth = 'max-w-lg',
  onClose,
  children,
}: BaseModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`mx-4 w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none`}
      >
        {title && (
          <div className="mb-4">
            <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{description}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
