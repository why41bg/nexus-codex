import type { ApiKey } from '@/types';
import ApiKeyManager from './ApiKeyManager';

interface Props {
  apiKeys: ApiKey[];
  models: string[];
  loading: boolean;
  onRefresh: () => void;
}

export default function ApiKeysTab({ apiKeys, models, loading, onRefresh }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">API Key 管理</h2>
      <p className="mt-1 text-sm text-gray-500">管理 API Key 访问权限与模型配置</p>

      <ApiKeyManager apiKeys={apiKeys} models={models} loading={loading} onRefresh={onRefresh} />
    </div>
  );
}
