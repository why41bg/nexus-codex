import type { ApiKey, ApiKeyTemplate } from '@/types';
import ApiKeyManager from './ApiKeyManager';
import ApiKeyTemplateManager from './ApiKeyTemplateManager';

interface Props {
  apiKeys: ApiKey[];
  templates: ApiKeyTemplate[];
  models: string[];
  loading: boolean;
  onRefresh: () => void;
}

export default function ApiKeysTab({ apiKeys, templates, models, loading, onRefresh }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">API Key 管理</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">管理 API Key 访问权限、模型配置与自助申领模板</p>

      <ApiKeyTemplateManager templates={templates} models={models} loading={loading} onRefresh={onRefresh} />
      <ApiKeyManager apiKeys={apiKeys} models={models} loading={loading} onRefresh={onRefresh} />
    </div>
  );
}
