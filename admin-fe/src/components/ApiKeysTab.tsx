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
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">API Key \u7ba1\u7406</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">\u7ba1\u7406 API Key \u8bbf\u95ee\u6743\u9650\u4e0e\u6a21\u578b\u914d\u7f6e</p>

      <ApiKeyManager apiKeys={apiKeys} models={models} loading={loading} onRefresh={onRefresh} />
    </div>
  );
}
