import { useState } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, primaryBtnClass } from '@/lib/styles';
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

  return (
    <div className="mt-8 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="text-sm font-semibold text-gray-900">添加账号</h2>
      <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">
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
        <div className="sm:w-56">
          <label className="mb-1 block text-xs font-medium text-gray-600">备注</label>
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="email@example.com"
            className={inputClass}
          />
        </div>
        <div className="sm:w-28">
          <label className="mb-1 block text-xs font-medium text-gray-600">最大并发</label>
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
    </div>
  );
}
