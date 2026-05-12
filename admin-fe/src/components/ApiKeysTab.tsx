import type { ApiKey, ApiKeyTemplate } from '@/types';
import ApiKeyManager from './ApiKeyManager';
import ApiKeyTemplateManager from './ApiKeyTemplateManager';
import AdminPageHeader from './AdminPageHeader';

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
      <AdminPageHeader
        title="API Key 管理"
        description="管理 API Key 访问权限、模型配置与自助申领模板"
      />

      <ApiKeyTemplateManager templates={templates} models={models} loading={loading} onRefresh={onRefresh} />
      <ApiKeyManager apiKeys={apiKeys} models={models} loading={loading} onRefresh={onRefresh} />
    </div>
  );
}
