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

/** 延迟分位数响应 */
export interface PercentileResponse {
  p50: number;
  p95: number;
  p99: number;
  range: string;
  sampleCount: number;
}

/** KPI 周期数据 */
export interface PeriodMetrics {
  requests: number;
  errors: number;
  avgLatencyMs: number;
  successRate: number;
  errorRate: number;
}

/** KPI 环比变化 */
export interface KpiChanges {
  requests: number | null;
  errors: number | null;
  avgLatencyMs: number | null;
  successRate: number | null;
  errorRate: number | null;
}

/** KPI 汇总响应（含环比） */
export interface SummaryResponse {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  changes: KpiChanges;
  range: string;
}

/** 结构化日志条目 */
export interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  source: string;
  event: string;
  message: string;
  context: Record<string, unknown> | null;
  trace_id: string | null;
  session_id: string | null;
  account_id: string | null;
  api_key_id: string | null;
  client_ip: string | null;
  duration_ms: number | null;
  tags: string[];
}

/** 日志查询结果 */
export interface LogQueryResult {
  items: LogEntry[];
  total: number;
  limit: number;
  offset: number;
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
  /** 是否启用 */
  enabled?: boolean;
  models: string[];
  effectiveModels: string[];
  createdAt?: string;
  /** 过期时间（ISO 字符串），null 表示永不过期 */
  expiresAt?: string | null;
  source?: 'admin' | 'self_service';
  templateId?: string | null;
  templateName?: string | null;
  applicantName?: string | null;
  applicantContact?: string | null;
  applicantNote?: string | null;

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

/** Per-Key 使用统计 */
export interface PerKeyStats {
  apiKeyPrefix: string;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  avgLatencyMs: number;
  lastUsed: number;
}

/** 系统可用性状态 */
export interface SystemStatus {
  level: 'green' | 'yellow' | 'red';
  totalAccounts: number;
  healthyAccounts: number;
  totalSlots: number;
  availableSlots: number;
}

/** API Key 自助申领模板 */
export interface ApiKeyTemplate {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  models: string[];
  requireClaimCode: boolean;
  claimCode?: string;
  claimCodeMaxUsage?: number | null;
  claimCodeUsedCount?: number;
  rateLimitMax?: number | null;
  rateLimitWindowMs?: number | null;
  monthlyQuota?: number | null;
  claimIpLimitMax: number;
  claimIpLimitWindowMs: number;
  createdAt?: string;
  updatedAt?: string | null;
}
