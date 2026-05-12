import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { useFocusTrap } from '../lib/use-focus-trap';
import { CloseIcon } from './icons';

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
  /** 面板额外 class，默认包含 p-6 */
  panelClassName?: string;
  /** 是否展示右上角关闭按钮 */
  showCloseButton?: boolean;
  /** 是否隐藏默认标题区，仅保留可访问性标题 */
  hideHeader?: boolean;
  /** 首次打开时优先聚焦的元素 */
  initialFocusRef?: RefObject<{ focus: () => void } | null>;
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
  panelClassName = 'p-6',
  showCloseButton = false,
  hideHeader = false,
  initialFocusRef,
}: BaseModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    const focusTarget = initialFocusRef?.current ?? dialogRef.current;
    focusTarget?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [initialFocusRef, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative mx-4 w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none ${panelClassName}`}
      >
        {hideHeader ? (
          <>
            <h3 id={titleId} className="sr-only">
              {title}
            </h3>
            {description ? (
              <p id={descriptionId} className="sr-only">
                {description}
              </p>
            ) : null}
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                aria-label="关闭"
              >
                <CloseIcon size="h-5 w-5" />
              </button>
            ) : null}
          </>
        ) : (
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">
                {title}
              </h3>
              {description && (
                <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                aria-label="关闭"
              >
                <CloseIcon size="h-5 w-5" />
              </button>
            ) : null}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
