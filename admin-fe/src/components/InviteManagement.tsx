import { useState } from 'react';
import type { ContributionInvite } from '@/types';
import { copyToClipboard } from '@/lib/clipboard';
import { formatDuration } from '@/lib/time';
import {
  brandSubtleBtnClass,
  cardClass,
  dashedEmptyStateClass,
  dangerSubtleBtnClass,
  enabledStatusBadgeClass,
  iconButtonClass,
  primaryBtnClass,
  subtleBtnClass,
} from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import {
  useCreateContributionInvite,
  useUpdateContributionInvite,
  useDeleteContributionInvite,
  useToggleContributionInvite,
} from '@/hooks/useAdminMutations';
import ConfirmModal from './ConfirmModal';
import InviteFormModal, { type InviteFormState } from './InviteFormModal';
import { CopyIcon } from './icons';

interface Props {
  invites: ContributionInvite[];
}

function createDefaultInviteForm(): InviteFormState {
  return {
    name: '',
    note: '',
    code: '',
    enabled: true,
    maxUses: '',
    maxActiveSessions: '1',
    perIpLimitMax: '3',
    perIpLimitWindowMs: '86400000',
  };
}

function inviteToForm(invite: ContributionInvite): InviteFormState {
  return {
    name: invite.name,
    note: invite.note,
    code: invite.code || '',
    enabled: invite.enabled,
    maxUses: invite.maxUses != null ? String(invite.maxUses) : '',
    maxActiveSessions: String(invite.maxActiveSessions),
    perIpLimitMax: String(invite.perIpLimitMax),
    perIpLimitWindowMs: String(invite.perIpLimitWindowMs),
  };
}

function validateInviteForm(form: InviteFormState): string | null {
  if (!form.name.trim()) {
    return '邀请码名称不能为空';
  }
  if (form.code.trim() && !/^[A-Za-z0-9_-]{6,64}$/.test(form.code.trim())) {
    return '邀请码只能包含字母、数字、下划线和短横线，长度 6-64';
  }
  return null;
}

function toCreatePayload(form: InviteFormState) {
  return {
    name: form.name.trim(),
    note: form.note.trim(),
    code: form.code.trim() || undefined,
    enabled: form.enabled,
    maxUses: form.maxUses ? Number(form.maxUses) : undefined,
    maxActiveSessions: Number(form.maxActiveSessions || '1'),
    perIpLimitMax: Number(form.perIpLimitMax || '1'),
    perIpLimitWindowMs: Number(form.perIpLimitWindowMs || '86400000'),
  };
}

function toUpdatePayload(form: InviteFormState) {
  return {
    ...toCreatePayload(form),
    code: form.code.trim(),
    maxUses: form.maxUses ? Number(form.maxUses) : null,
  };
}

export default function InviteManagement({ invites }: Props) {
  const { toast } = useToast();
  const [createForm, setCreateForm] = useState<InviteFormState>(() => createDefaultInviteForm());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const [editingInvite, setEditingInvite] = useState<ContributionInvite | null>(null);
  const [editForm, setEditForm] = useState<InviteFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContributionInvite | null>(null);

  const createMutation = useCreateContributionInvite();
  const updateMutation = useUpdateContributionInvite();
  const deleteMutation = useDeleteContributionInvite();
  const toggleMutation = useToggleContributionInvite();

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateInviteForm(createForm);
    setError(validationError ?? '');
    if (validationError) return;
    try {
      await createMutation.mutateAsync(toCreatePayload(createForm));
      setCreateForm(createDefaultInviteForm());
      setShowCreateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建邀请码失败');
    }
  };

  const handleCopyInviteCode = async (code: string) => {
    await copyToClipboard(code);
    toast('邀请码已复制到剪贴板', 'success');
  };

  const openCreateInvite = () => {
    setError('');
    setCreateForm(createDefaultInviteForm());
    setShowCreateModal(true);
  };

  const openEditInvite = (invite: ContributionInvite) => {
    setError('');
    setEditingInvite(invite);
    setEditForm(inviteToForm(invite));
  };

  const saveInvite = async () => {
    if (!editingInvite || !editForm) return;
    const validationError = validateInviteForm(editForm);
    setError(validationError ?? '');
    if (validationError) return;
    try {
      await updateMutation.mutateAsync({
        id: editingInvite.id,
        body: toUpdatePayload(editForm),
      });
      setError('');
      setEditingInvite(null);
      setEditForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新邀请码失败');
    }
  };

  return (
    <section className={`${cardClass} p-6`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">邀请码管理</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            创建并管理共享入口的邀请码，控制使用次数与访问频率。
          </p>
        </div>
        <button type="button" onClick={openCreateInvite} className={primaryBtnClass}>
          创建邀请码
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {invites.length === 0 ? (
          <div className={dashedEmptyStateClass}>
            尚未创建邀请码，点击上方按钮开始
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">邀请码</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">限制</th>
                  <th className="px-4 py-3 font-medium">已用</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {invites.map((invite) => (
                  <tr key={invite.id} className="transition-colors hover:bg-gray-50/50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{invite.name}</td>
                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <span>{invite.codeMasked}</span>
                        {invite.code ? (
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => void handleCopyInviteCode(invite.code || '')}
                            title="复制邀请码"
                          >
                            <CopyIcon />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={enabledStatusBadgeClass(invite.enabled)}>
                        {invite.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      <div>同时在线: {invite.maxActiveSessions}</div>
                      <div>单 IP: {invite.perIpLimitMax} / {formatDuration(invite.perIpLimitWindowMs)}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                      {invite.usedCount}{invite.maxUses ? ` / ${invite.maxUses}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" className={subtleBtnClass} onClick={() => toggleMutation.mutate({ id: invite.id, enabled: !invite.enabled })}>
                          {invite.enabled ? '停用' : '启用'}
                        </button>
                        <button type="button" className={brandSubtleBtnClass} onClick={() => openEditInvite(invite)}>
                          编辑
                        </button>
                        <button type="button" className={dangerSubtleBtnClass} onClick={() => setDeleteTarget(invite)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal ? (
        <InviteFormModal
          title="创建邀请码"
          confirmLabel="创建"
          form={createForm}
          error={error}
          saving={createMutation.isPending}
          onChange={setCreateForm}
          onSubmit={createInvite}
          onClose={() => {
            setShowCreateModal(false);
            setError('');
          }}
        />
      ) : null}

      {editingInvite && editForm ? (
        <InviteFormModal
          title="编辑邀请码"
          confirmLabel="保存"
          form={editForm}
          error={error}
          saving={updateMutation.isPending}
          onChange={setEditForm}
          onSubmit={(e) => {
            e.preventDefault();
            void saveInvite();
          }}
          onClose={() => {
            setEditingInvite(null);
            setEditForm(null);
            setError('');
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmModal
          title="删除邀请码"
          confirmLabel="删除"
          loading={deleteMutation.isPending}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        >
          确定删除邀请码「{deleteTarget.name}」吗？已产生的共享记录不受影响。
        </ConfirmModal>
      ) : null}
    </section>
  );
}
