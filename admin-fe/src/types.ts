/** 账号运行时状态 */
export interface AccountRuntime {
  healthy: boolean;
  busy: boolean;
}

/** 账号信息 */
export interface Account {
  id: string;
  codexHome: string;
  remark?: string;
  enabled: boolean;
  usageCount: number;
  lastUsedAt?: string;
  runtime?: AccountRuntime;
}

/** Dashboard 汇总数据 */
export interface Dashboard {
  total?: number;
  available?: number;
  busy?: number;
  unhealthy?: number;
  disabled?: number;
  totalUsage?: number;
}

/** API Key 信息 */
export interface ApiKey {
  key: string;
  keyMasked: string;
  name?: string;
  models: string[];
  effectiveModels: string[];
  createdAt?: string;
}
