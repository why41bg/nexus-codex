/**
 * 统一的 Admin Mutation Hooks。
 *
 * 所有写操作（增删改）统一使用 useMutation，自动管理 loading/error 状态、
 * 缓存失效和 Toast 通知。各组件无需再手写 try/catch 样板代码。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Account, ApiKeyTemplate, QuotaInfo } from '@/types';
import { api, extractErrorMessage } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { queryKeys } from './useAdminQueries';

// ─── 错误消息提取工具 ─────────────────────────────────────────

/** 从 catch 中的 unknown 错误提取可读消息 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return '请求失败';
}

// ─── Account Mutations ────────────────────────────────────────

export function useAddAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: { codexHome: string; remark?: string; maxConcurrency?: number }) => {
      const res = await api('POST', '/api/admin/accounts', body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '添加失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('账号添加成功', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await api('PATCH', `/api/admin/accounts/${id}`, body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '操作失败'));
      return res.data;
    },
    onSuccess: (_data, vars) => {
      const msg = vars.body.enabled !== undefined
        ? (vars.body.enabled ? `已启用 ${vars.id}` : `已禁用 ${vars.id}`)
        : '账号配置已更新';
      toast(msg, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api('DELETE', `/api/admin/accounts/${id}`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '删除失败'));
      return res.data;
    },
    onSuccess: (_data, id) => {
      toast(`已删除 ${id}`, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useExportAccounts() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await api<{ accounts: Account[] }>('GET', '/api/admin/accounts/export');
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '导出失败'));
      return res.data;
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-codex-accounts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('导出成功', 'success');
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useBackup() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await api<Record<string, unknown>>('GET', '/api/admin/backup');
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '备份失败'));
      return res.data;
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-codex-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('备份下载成功', 'success');
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useImportAccounts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: { accounts: unknown[]; mode: string }) => {
      const res = await api<{ imported: number; skipped: number; errors: Array<{ index: number; message: string }> }>(
        'POST',
        '/api/admin/accounts/import',
        body,
      );
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '导入失败'));
      return res.data;
    },
    onSuccess: (data) => {
      const parts: string[] = [`成功导入 ${data.imported} 个账号`];
      if (data.skipped > 0) parts.push(`跳过 ${data.skipped} 个重复`);
      if (data.errors.length > 0) parts.push(`${data.errors.length} 个失败`);
      toast(parts.join('，'), data.errors.length > 0 ? 'error' : 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useFetchAccountQuota() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, forceRefresh = false }: { id: string; forceRefresh?: boolean }) => {
      const res = await api<{ quota?: QuotaInfo; error?: { message: string } }>(
        forceRefresh ? 'POST' : 'GET',
        forceRefresh
          ? `/api/admin/accounts/${id}/quota/refresh`
          : `/api/admin/accounts/${id}/quota`,
      );
      if (!res.ok || !res.data.quota) {
        throw new Error(extractErrorMessage(res.data, '获取额度失败'));
      }
      return { id, quota: res.data.quota };
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useFetchAllAccountQuotas() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await api<{ quotas?: Record<string, { quota?: QuotaInfo; error?: { message: string } }> }>(
        'POST',
        '/api/admin/accounts/quota/batch',
      );
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '批量查询失败'));
      return res.data.quotas ?? {};
    },
    onSuccess: () => {
      toast('已刷新全部账号额度', 'success');
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

// ─── API Key Mutations ────────────────────────────────────────

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: { name: string; models: string[] }) => {
      const res = await api<{ key: string }>('POST', '/api/admin/keys', body);
      if (!res.ok || !res.data?.key) throw new Error(extractErrorMessage(res.data, '生成失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('API Key 已生成', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ keyPrefix, body }: { keyPrefix: string; body: Record<string, unknown> }) => {
      const res = await api('PATCH', `/api/admin/keys/${encodeURIComponent(keyPrefix)}`, body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '更新失败'));
      return res.data;
    },
    onSuccess: (_data, vars) => {
      const msg = vars.body.enabled !== undefined
        ? (vars.body.enabled ? '已启用' : '已禁用')
        : 'API Key 已更新';
      toast(msg, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (keyPrefix: string) => {
      const res = await api('DELETE', `/api/admin/keys/${encodeURIComponent(keyPrefix)}`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '删除失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('API Key 已删除', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useBatchApiKeyAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: { keyPrefixes: string[]; action: 'delete' | 'enable' | 'disable' }) => {
      const res = await api<{ succeeded: number; failed: number }>('POST', '/api/admin/keys/batch', body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '批量操作失败'));
      return res.data;
    },
    onSuccess: (data) => {
      toast(`操作完成：成功 ${data?.succeeded ?? 0}，失败 ${data?.failed ?? 0}`, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useRevealApiKey() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ keyPrefix, password }: { keyPrefix: string; password: string }) => {
      const res = await api<{ key: string }>('POST', '/api/admin/keys/reveal', { keyPrefix, password });
      if (!res.ok || !res.data?.key) throw new Error(extractErrorMessage(res.data, '验证失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('完整 Key 已复制到剪贴板', 'success');
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

// ─── API Key Template Mutations ───────────────────────────────

export function useSaveApiKeyTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: Record<string, unknown> }) => {
      const path = id
        ? `/api/admin/key-templates/${encodeURIComponent(id)}`
        : '/api/admin/key-templates';
      const method = id ? 'PATCH' : 'POST';
      const res = await api<{ template: ApiKeyTemplate }>(method, path, body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '保存失败'));
      return res.data;
    },
    onSuccess: (_data, vars) => {
      toast(vars.id ? '申领模板已更新' : '申领模板已创建', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeyTemplates });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useDeleteApiKeyTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api('DELETE', `/api/admin/key-templates/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '删除失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('申领模板已删除', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeyTemplates });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useResetClaimUsage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const res = await api('POST', `/api/admin/key-templates/${encodeURIComponent(templateId)}/reset-usage`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '重置失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('申领码用量已重置', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeyTemplates });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

// ─── Model Mutations ──────────────────────────────────────────

export function useAddModel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (model: string) => {
      const res = await api<{ models: string[] }>('POST', '/api/admin/models', { model });
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '添加失败'));
      return res.data;
    },
    onSuccess: (_data, model) => {
      toast(`已添加模型 ${model}`, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (model: string) => {
      const res = await api<{ models: string[] }>('DELETE', `/api/admin/models/${encodeURIComponent(model)}`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '移除失败'));
      return res.data;
    },
    onSuccess: (_data, model) => {
      toast(`已移除模型 ${model}`, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

// ─── Banned IP Mutations ──────────────────────────────────────

export function useBanIp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: { ip: string; reason: string }) => {
      const res = await api('POST', '/api/admin/banned-ips', body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '拉黑失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('IP 已加入黑名单', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.bannedIps });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useUnbanIp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (ip: string) => {
      const res = await api('DELETE', `/api/admin/banned-ips/${encodeURIComponent(ip)}`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '解除失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('IP 已解除拉黑', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.bannedIps });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useBatchUnbanIps() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (ips: string[]) => {
      const res = await api('POST', '/api/admin/banned-ips/batch-unban', { ips });
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '批量解除失败'));
      return res.data;
    },
    onSuccess: (_data, ips) => {
      toast(`已批量解除 ${ips.length} 个 IP 的拉黑`, 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.bannedIps });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

// ─── Contribution Invite Mutations ────────────────────────────

export function useCreateContributionInvite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api('POST', '/api/admin/contribution-invites', body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '创建邀请码失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('邀请码已创建', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.contributionInvites });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useUpdateContributionInvite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await api('PATCH', `/api/admin/contribution-invites/${id}`, body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '更新邀请码失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('邀请码已更新', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.contributionInvites });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useDeleteContributionInvite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api('DELETE', `/api/admin/contribution-invites/${id}`);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '删除邀请码失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('邀请码已删除', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.contributionInvites });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useToggleContributionInvite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await api('PATCH', `/api/admin/contribution-invites/${id}`, { enabled });
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '操作失败'));
      return res.data;
    },
    onSuccess: (_data, vars) => {
      toast(vars.enabled ? '邀请码已启用' : '邀请码已停用', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.contributionInvites });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

export function useReviewContribution() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ recordId, body }: { recordId: string; body: Record<string, unknown> }) => {
      const res = await api('POST', `/api/admin/contributions/${recordId}/review`, body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '审核操作失败'));
      return res.data;
    },
    onSuccess: (_data, vars) => {
      const action = (vars.body as { action?: string }).action;
      toast(action === 'approve' ? '已批准' : '已拒绝', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.contributionRecords });
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}

// ─── Settings Mutations ───────────────────────────────────────

export function useSaveSettings() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: Record<string, string>) => {
      const res = await api<{ updated: Record<string, string> }>('PATCH', '/api/admin/settings', body);
      if (!res.ok) throw new Error(extractErrorMessage(res.data, '保存失败'));
      return res.data;
    },
    onSuccess: () => {
      toast('设置已保存', 'success');
    },
    onError: (err) => toast(getErrorMessage(err), 'error'),
  });
}
