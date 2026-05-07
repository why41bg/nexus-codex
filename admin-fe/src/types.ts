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
  /** 最近 1 小时请求数 */
  recentRequests1h?: number;
  /** 最近 1 小时错误数 */
  recentErrors1h?: number;
  /** 最近 1 小时平均延迟 (ms) */
  avgLatency1h?: number;
}

/** 时间序列单个桶 */
export interface TimeSeriesBucket {
  timestamp: number;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
}

/** 时间序列响应 */
export interface TimeSeriesResponse {
  buckets: TimeSeriesBucket[];
  range: string;
}

/** 聚合分解响应 */
export interface MetricsBreakdown {
  byModel: Array<{ model: string; count: number; percentage: number }>;
  byAccount: Array<{ accountId: string; count: number; percentage: number }>;
  totals: {
    requests: number;
    errors: number;
    avgLatencyMs: number;
    errorRate: number;
  };
  since: number;
}

/** 被拉黑的 IP */
export interface BannedIP {
  ip: string;
  reason: string;
  bannedAt: string;
  hitCount: number;
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

  // ——— 权限粒度扩展字段 ———
  /** 独立速率限制（req/window），null 继承全局 */
  rateLimitMax?: number | null;
  /** 独立限流窗口（ms），null 继承全局 */
  rateLimitWindowMs?: number | null;
  /** 月调用次数上限，null 不限制 */
  monthlyQuota?: number | null;
  /** 当月已用次数 */
  monthlyUsage?: number;
  /** IP 白名单 */
  ipWhitelist?: string[];
}
