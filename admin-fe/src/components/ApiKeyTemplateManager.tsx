import { useState } from 'react';
import type { ApiKeyTemplate } from '@/types';
import { api, API_BASE, extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { formatDuration } from '@/lib/time';
import { cardClass, primaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { CopyIcon } from './icons';
import ConfirmModal from './ConfirmModal';
import TemplateFormModal from './TemplateFormModal';
import Spinner from './Spinner';

interface Props {
  templates: ApiKeyTemplate[];
  models: string[];
  loading: boolean;
  onRefresh: () => void;
}

export default function ApiKeyTemplateManager({ templates, models, loading, onRefresh }: Props) {
  const { toast } = useToast();
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ApiKeyTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = () => {
    setEditingTemplate(null);
    setShowFormModal(true);
  };

  const openEdit = (template: ApiKeyTemplate) => {
    setEditingTemplate(template);
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingTemplate(null);
  };

  const copyClaimLink = async (template: ApiKeyTemplate) => {
    const base = window.location.origin || API_BASE;
    const url = `${base}/claim?template=${encodeURIComponent(template.id)}`;
    await copyToClipboard(url);
    toast('申领链接已复制', 'success');
  };

  const copyClaimCodeFn = async (code: string) => {
    await copyToClipboard(code);
    toast('申领码已复制', 'success');
  };

  const resetClaimUsage = async (templateId: string) => {
    const res = await api('POST', `/api/admin/key-templates/${encodeURIComponent(templateId)}/reset-usage`);
    if (res.ok) {
      toast('申领码用量已重置', 'success');
      onRefresh();
    } else {
      toast(extractErrorMessage(res.data, '重置失败'), 'error');
    }
  };

  const deleteTemplate = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api('DELETE', `/api/admin/key-templates/${encodeURIComponent(deleteTarget.id)}`);
      if (res.ok) {
        toast('申领模板已删除', 'success');
        setDeleteTarget(null);
        onRefresh();
      } else {
        toast(extractErrorMessage(res.data, '删除失败'), 'error');
      }
    } catch {
      toast('请求失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`mt-6 ${cardClass} p-6`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">自助申领模板</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            用户在门户申领 API Key 时，系统会复制模板中的模型、额度、限流和申领码策略。
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className={primaryBtnClass}
        >
          创建模板
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {loading && templates.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-5 w-5 text-brand-600" />
            <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">加载中...</span>
          </div>
        )}
        {!loading && templates.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
            暂无申领模板，点击上方按钮创建
          </div>
        )}
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{template.name}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${template.enabled ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {template.enabled ? '已启用' : '已停用'}
                  </span>
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                    {template.requireClaimCode ? '需要申领码' : '无需申领码'}
                  </span>
                </div>
                {template.description && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{template.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {template.models.map((model) => (
                    <span key={model} className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800">
                      {model}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs text-gray-500 dark:text-slate-400">
                  <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                    同 IP 限 {template.claimIpLimitMax} 次 / {formatDuration(template.claimIpLimitWindowMs)}
                  </span>
                  {template.requireClaimCode && template.claimCodeMaxUsage != null && (
                    <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                      申领码限 {template.claimCodeMaxUsage} 次（已用 {template.claimCodeUsedCount ?? 0}）
                    </span>
                  )}
                  {template.rateLimitMax != null && (
                    <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                      限速 {template.rateLimitMax} 次 / {formatDuration(template.rateLimitWindowMs ?? 60000)}
                    </span>
                  )}
                  {template.monthlyQuota != null && (
                    <span className="rounded bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-slate-700 dark:ring-slate-600">
                      月额度 {template.monthlyQuota.toLocaleString()}
                    </span>
                  )}
                </div>
                {/* 申领码快捷展示 */}
                {template.requireClaimCode && template.claimCode && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-xs text-gray-400 dark:text-slate-500">申领码:</span>
                    <code className="rounded bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:text-slate-300">
                      {template.claimCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyClaimCodeFn(template.claimCode!)}
                      className="rounded p-0.5 text-gray-400 dark:text-slate-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 dark:hover:text-slate-300"
                      title="复制申领码"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyClaimLink(template)}
                  className="rounded-md bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                  title="复制申领链接"
                >
                  <span className="inline-flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                    链接
                  </span>
                </button>
                {template.requireClaimCode && template.claimCodeMaxUsage != null && (template.claimCodeUsedCount ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => resetClaimUsage(template.id)}
                    className="rounded-md bg-yellow-50 px-2.5 py-1 text-xs font-medium text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-950 dark:text-yellow-400 dark:hover:bg-yellow-900"
                    title="重置申领码用量"
                  >
                    重置用量
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(template)}
                  className="rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(template)}
                  className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      {showFormModal && (
        <TemplateFormModal
          editing={editingTemplate}
          models={models}
          onClose={closeFormModal}
          onSaved={onRefresh}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmModal
          title="确认删除申领模板"
          confirmLabel="删除"
          loading={deleting}
          onConfirm={deleteTemplate}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>确定要删除申领模板 <span className="font-semibold">{deleteTarget.name}</span> 吗？已有 API Key 不会被删除。</p>
        </ConfirmModal>
      )}
    </div>
  );
}
