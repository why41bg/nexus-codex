/**
 * 独立的 Admin 数据 Query Hooks。
 * 每类数据使用独立的 query key，支持按需加载和精准 invalidate。
 */
import { useQuery } from '@tanstack/react-query';
import type {
  Account,
  Dashboard,
  ApiKey,
  ApiKeyTemplate,
  BannedIP,
  ContributionInvite,
  ContributionRecord,
} from '@/types';
import { api } from '@/lib/api';

// ─── Query Keys ─────────────────────────────────────────────────

export const queryKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  accounts: ['admin', 'accounts'] as const,
  models: ['admin', 'models'] as const,
  apiKeys: ['admin', 'apiKeys'] as const,
  apiKeyTemplates: ['admin', 'apiKeyTemplates'] as const,
  bannedIps: ['admin', 'bannedIps'] as const,
  contributionInvites: ['admin', 'contributionInvites'] as const,
  contributionRecords: ['admin', 'contributionRecords'] as const,
};

// ─── Individual Query Hooks ──────────────────────────────────────

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async () => {
      const res = await api<Dashboard>('GET', '/api/admin/dashboard');
      return res.ok ? res.data : ({} as Dashboard);
    },
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: async () => {
      const res = await api<{ accounts: Account[] }>('GET', '/api/admin/accounts');
      return res.ok ? (res.data.accounts || []) : [];
    },
  });
}

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: async () => {
      const res = await api<{ models: string[] }>('GET', '/api/admin/models');
      return res.ok ? (res.data.models || []) : [];
    },
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: async () => {
      const res = await api<{ keys: ApiKey[] }>('GET', '/api/admin/keys');
      return res.ok ? (res.data.keys || []) : [];
    },
  });
}

export function useApiKeyTemplates() {
  return useQuery({
    queryKey: queryKeys.apiKeyTemplates,
    queryFn: async () => {
      const res = await api<{ templates: ApiKeyTemplate[] }>('GET', '/api/admin/key-templates');
      return res.ok ? (res.data.templates || []) : [];
    },
  });
}

export function useBannedIps() {
  return useQuery({
    queryKey: queryKeys.bannedIps,
    queryFn: async () => {
      const res = await api<{ bannedIps: BannedIP[] }>('GET', '/api/admin/banned-ips');
      return res.ok ? (res.data.bannedIps || []) : [];
    },
  });
}

export function useContributionInvites() {
  return useQuery({
    queryKey: queryKeys.contributionInvites,
    queryFn: async () => {
      const res = await api<{ invites: ContributionInvite[] }>('GET', '/api/admin/contribution-invites');
      return res.ok ? (res.data.invites || []) : [];
    },
  });
}

export function useContributionRecords() {
  return useQuery({
    queryKey: queryKeys.contributionRecords,
    queryFn: async () => {
      const res = await api<{ records: ContributionRecord[] }>('GET', '/api/admin/contributions');
      return res.ok ? (res.data.records || []) : [];
    },
  });
}
