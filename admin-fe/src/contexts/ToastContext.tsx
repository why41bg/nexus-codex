import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, type?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const toast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 3000);
    timersRef.current.set(id, timer);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast }}>
      {children}
      {/* Toast 通知区域 */}
      <div className="fixed right-4 top-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ring-1 ${
              t.type === 'success'
                ? 'bg-green-600 text-white ring-green-700'
                : 'bg-red-600 text-white ring-red-700'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
