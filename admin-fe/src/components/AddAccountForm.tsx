import { useState } from 'react';
import { api } from '@/lib/api';
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
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!codexHome.trim()) return;
    setAdding(true);
    try {
      const res = await api('POST', '/api/admin/accounts', {
        codexHome: codexHome.trim(),
        remark: remark.trim(),
      });
      if (authGuard(res.status)) return;
      if (res.ok) {
        toast('账号添加成功', 'success');
        setCodexHome('');
        setRemark('');
        onAdded();
      } else {
        toast((res.data as { error?: { message?: string } })?.error?.message || '添加失败', 'error');
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
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            CODEX_HOME 路径 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={codexHome}
            onChange={(e) => setCodexHome(e.target.value)}
            placeholder="/Users/you/.codex-pool/account-x"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div className="sm:w-56">
          <label className="mb-1 block text-xs font-medium text-gray-600">备注</label>
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="email@example.com"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!codexHome.trim() || adding}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50"
        >
          {adding && <Spinner className="mr-1.5 h-4 w-4" />}
          添加
        </button>
      </div>
    </div>
  );
}
