import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiKeyTemplate } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/contexts/ToastContext';
import Spinner from './Spinner';

interface ClaimResult {
  key: string;
  keyPrefix: string;
  models: string[];
  rateLimitMax?: number | null;
  rateLimitWindowMs?: number | null;
  monthlyQuota?: number | null;
}

export default function ClaimKeyPage() {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantContact, setApplicantContact] = useState('');
  const [note, setNote] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [templateIdInitialized, setTemplateIdInitialized] = useState(false);

  const { data: templates = [], isLoading: loading } = useQuery({
    queryKey: ['public', 'key-templates'],
    queryFn: async () => {
      const res = await api<{ templates: ApiKeyTemplate[] }>('GET', '/api/public/key-templates');
      if (!res.ok) throw new Error('加载模板失败');
      return res.data.templates || [];
    },
  });

  // Auto-select the first template once loaded
  if (templates.length > 0 && !templateIdInitialized) {
    setTemplateId(templates[0].id);
    setTemplateIdInitialized(true);
  }

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId) || null,
    [templates, templateId],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api<ClaimResult>('POST', '/api/public/keys/claim', {
        templateId,
        applicantName,
        applicantContact,
        note,
        claimCode,
      });
      if (res.ok) {
        setResult(res.data);
        setClaimCode('');
        toast('API Key 已生成', 'success');
      } else {
        toast(extractErrorMessage(res.data, '申领失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!result) return;
    await copyToClipboard(result.key);
    toast('已复制到剪贴板', 'success');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
          返回门户
        </Link>
        <div className="mt-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">申领 API Key</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            选择可用模板并填写申请信息，生成的完整 Key 仅在本次页面展示。
          </p>
        </div>

        <div className={`mt-6 ${cardClass} p-6`}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
              <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
              当前没有可用的申领模板
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {templates.length > 1 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申领模板</label>
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputClass}>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedTemplate && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{selectedTemplate.name}</span>
                    {selectedTemplate.requireClaimCode && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">需要申领码</span>
                    )}
                  </div>
                  {selectedTemplate.description && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{selectedTemplate.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {selectedTemplate.models.map((model) => (
                      <span key={model} className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800">
                        {model}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申请人名称</label>
                  <input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} required className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">联系方式</label>
                  <input value={applicantContact} onChange={(e) => setApplicantContact(e.target.value)} required className={inputClass} />
                </div>
              </div>

              {selectedTemplate?.requireClaimCode && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">申领码</label>
                  <input value={claimCode} onChange={(e) => setClaimCode(e.target.value)} required className={inputClass} />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">用途备注</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputClass} />
              </div>

              <button type="submit" disabled={submitting || !selectedTemplate} className={primaryBtnClass}>
                {submitting && <Spinner className="mr-1.5 h-4 w-4" />}
                生成 API Key
              </button>
            </form>
          )}
        </div>

        {result && (
          <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-950">
            <h2 className="text-sm font-semibold text-green-900 dark:text-green-200">API Key 已生成</h2>
            <p className="mt-1 text-xs text-green-700 dark:text-green-300">完整 Key 仅本次展示，请立即复制保存。</p>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-sm text-green-900 ring-1 ring-green-200 dark:bg-slate-800 dark:text-green-200 dark:ring-green-800">
                {result.key}
              </code>
              <button type="button" onClick={copyKey} className={secondaryBtnClass}>复制</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
