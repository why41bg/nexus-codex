import { useState } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, primaryBtnClass, cardClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import Spinner from './Spinner';

interface Props {
  onAdded: () => void;
}

export default function AddAccountForm({ onAdded }: Props) {
  const { toast } = useToast();
  const authGuard = useAuthGuard();
  const [codexHome, setCodexHome] = useState('');
  const [remark, setRemark] = useState('');
  const [maxConcurrency, setMaxConcurrency] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!codexHome.trim()) return;
    setAdding(true);
    try {
      const res = await api('POST', '/api/admin/accounts', {
        codexHome: codexHome.trim(),
        remark: remark.trim(),
        ...(maxConcurrency && { maxConcurrency: Number(maxConcurrency) }),
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('\u8d26\u53f7\u6dfb\u52a0\u6210\u529f', 'success');
        setCodexHome('');
        setRemark('');
        setMaxConcurrency('');
        onAdded();
      } else {
        toast(extractErrorMessage(res.data, '\u6dfb\u52a0\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={`mt-6 ${cardClass} p-6`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">\u6dfb\u52a0\u8d26\u53f7</h2>
      <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            CODEX_HOME \u8def\u5f84 <span className="text-red-400">*</span>
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
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u5907\u6ce8</label>
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="email@example.com"
            className={inputClass}
          />
        </div>
        <div className="md:w-28">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">\u6700\u5927\u5e76\u53d1</label>
          <input
            type="number"
            min="1"
            value={maxConcurrency}
            onChange={(e) => setMaxConcurrency(e.target.value)}
            placeholder="\u9ed8\u8ba4"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={!codexHome.trim() || adding}
          className={primaryBtnClass}
        >
          {adding && <Spinner className="mr-1.5 h-4 w-4" />}
          \u6dfb\u52a0
        </button>
      </form>
    </div>
  );
}
