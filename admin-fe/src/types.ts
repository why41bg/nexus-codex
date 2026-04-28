/** 账号运行时状态 */
export interface AccountRuntime {
  healthy: boolean;
  activeCount: number;
  maxConcurrency: number;
}

/** 额度窗口信息 */
export interface QuotaWindow {
  /** 已使用百分比（0-100） */
  usedPercent: number;
  /** 窗口时长（分钟） */
  windowDurationMins: number;
  /** 重置时间（Unix 时间戳，秒） */
  resetsAt: number;
}

/** 账号额度信息 */
export interface QuotaInfo {
  /** 5小时滚动窗口 */
  primary: QuotaWindow;
  /** 1周滚动窗口 */
  secondary: QuotaWindow;
  planType: string;
  rateLimitReachedType: string | null;
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
  totalSlots?: number;
  activeSlots?: number;
  availableSlots?: number;
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
