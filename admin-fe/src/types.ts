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
  /** 完整 key（仅创建时返回，列表接口不返回） */
  key?: string;
  keyMasked: string;
  /** key 前缀，用于标识（如 sk-abcde） */
  keyPrefix: string;
  name?: string;
  models: string[];
  effectiveModels: string[];
  createdAt?: string;
}
