/**
 * 内存指标收集器 — 基于 Ring Buffer 的轻量级请求指标系统。
 * 每分钟一个桶，保留最近 24 小时数据（1440 个桶），总内存约 300KB。
 */

/** 单个分钟桶 */
interface MetricsBucket {
  /** 该分钟的起始时间戳（精确到分钟，ms） */
  timestamp: number;
  /** 该分钟内的请求总数 */
  requestCount: number;
  /** 该分钟内的错误请求数 */
  errorCount: number;
  /** 该分钟内所有请求的累计耗时（ms） */
  totalLatencyMs: number;
  /** 按模型的请求计数 */
  modelCounts: Map<string, number>;
  /** 按账号的请求计数 */
  accountCounts: Map<string, number>;
}

/** record() 方法的参数 */
export interface MetricsEvent {
  model: string;
  accountId: string;
  latencyMs: number;
  success: boolean;
}

/** 时间序列返回中的单个桶 */
export interface TimeSeriesBucket {
  timestamp: number;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
}

/** breakdown 返回 */
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

const BUCKET_COUNT = 1440; // 24h × 60min
const BUCKET_DURATION_MS = 60_000; // 1 分钟

function createEmptyBucket(timestamp: number): MetricsBucket {
  return {
    timestamp,
    requestCount: 0,
    errorCount: 0,
    totalLatencyMs: 0,
    modelCounts: new Map(),
    accountCounts: new Map(),
  };
}

function getBucketTimestamp(nowMs: number): number {
  return Math.floor(nowMs / BUCKET_DURATION_MS) * BUCKET_DURATION_MS;
}

class MetricsCollector {
  private buckets: MetricsBucket[];
  private currentIndex: number;

  constructor() {
    const now = getBucketTimestamp(Date.now());
    this.buckets = new Array(BUCKET_COUNT);
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.buckets[i] = createEmptyBucket(0);
    }
    this.currentIndex = 0;
    // 初始化当前桶
    this.buckets[0] = createEmptyBucket(now);
  }

  /** 记录一次请求结果 */
  record(event: MetricsEvent): void {
    const now = Date.now();
    const ts = getBucketTimestamp(now);
    const bucket = this.getOrCreateBucket(ts);

    bucket.requestCount++;
    if (!event.success) bucket.errorCount++;
    bucket.totalLatencyMs += event.latencyMs;
    bucket.modelCounts.set(event.model, (bucket.modelCounts.get(event.model) ?? 0) + 1);
    bucket.accountCounts.set(event.accountId, (bucket.accountCounts.get(event.accountId) ?? 0) + 1);
  }

  /** 获取指定时间范围的时间序列 */
  getTimeSeries(range: '1h' | '6h' | '24h'): { buckets: TimeSeriesBucket[]; range: string } {
    const rangeMs = range === '1h' ? 3600_000 : range === '6h' ? 21600_000 : 86400_000;
    const now = Date.now();
    const since = getBucketTimestamp(now - rangeMs);
    const result: TimeSeriesBucket[] = [];

    for (const bucket of this.buckets) {
      if (bucket.timestamp >= since && bucket.timestamp <= now && bucket.requestCount > 0) {
        result.push({
          timestamp: bucket.timestamp,
          requestCount: bucket.requestCount,
          errorCount: bucket.errorCount,
          avgLatencyMs: bucket.requestCount > 0
            ? Math.round(bucket.totalLatencyMs / bucket.requestCount)
            : 0,
        });
      }
    }

    // 按时间戳排序
    result.sort((a, b) => a.timestamp - b.timestamp);
    return { buckets: result, range };
  }

  /** 获取聚合快照（breakdown） */
  getBreakdown(): MetricsBreakdown {
    const now = Date.now();
    const since = getBucketTimestamp(now - 86400_000); // 24h
    const modelTotals = new Map<string, number>();
    const accountTotals = new Map<string, number>();
    let totalRequests = 0;
    let totalErrors = 0;
    let totalLatencyMs = 0;

    for (const bucket of this.buckets) {
      if (bucket.timestamp >= since && bucket.timestamp <= now && bucket.requestCount > 0) {
        totalRequests += bucket.requestCount;
        totalErrors += bucket.errorCount;
        totalLatencyMs += bucket.totalLatencyMs;
        for (const [model, count] of bucket.modelCounts) {
          modelTotals.set(model, (modelTotals.get(model) ?? 0) + count);
        }
        for (const [accountId, count] of bucket.accountCounts) {
          accountTotals.set(accountId, (accountTotals.get(accountId) ?? 0) + count);
        }
      }
    }

    const byModel = [...modelTotals.entries()]
      .map(([model, count]) => ({
        model,
        count,
        percentage: totalRequests > 0 ? Math.round((count / totalRequests) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const byAccount = [...accountTotals.entries()]
      .map(([accountId, count]) => ({
        accountId,
        count,
        percentage: totalRequests > 0 ? Math.round((count / totalRequests) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      byModel,
      byAccount,
      totals: {
        requests: totalRequests,
        errors: totalErrors,
        avgLatencyMs: totalRequests > 0 ? Math.round(totalLatencyMs / totalRequests) : 0,
        errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 100 : 0,
      },
      since,
    };
  }

  /** 获取最近指定时间窗口的快照（用于 dashboard 扩展字段） */
  getRecentSnapshot(rangeMs: number): { requests: number; errors: number; avgLatencyMs: number } {
    const now = Date.now();
    const since = getBucketTimestamp(now - rangeMs);
    let requests = 0;
    let errors = 0;
    let totalLatency = 0;

    for (const bucket of this.buckets) {
      if (bucket.timestamp >= since && bucket.timestamp <= now && bucket.requestCount > 0) {
        requests += bucket.requestCount;
        errors += bucket.errorCount;
        totalLatency += bucket.totalLatencyMs;
      }
    }

    return {
      requests,
      errors,
      avgLatencyMs: requests > 0 ? Math.round(totalLatency / requests) : 0,
    };
  }

  private getOrCreateBucket(ts: number): MetricsBucket {
    // 检查当前桶是否匹配
    const current = this.buckets[this.currentIndex];
    if (current.timestamp === ts) return current;

    // 需要向前推进
    // 计算需要跳过多少个桶
    const steps = Math.floor((ts - current.timestamp) / BUCKET_DURATION_MS);
    if (steps > 0 && steps < BUCKET_COUNT) {
      // 跳过中间的桶（重置它们）
      for (let i = 1; i <= Math.min(steps, BUCKET_COUNT); i++) {
        const idx = (this.currentIndex + i) % BUCKET_COUNT;
        this.buckets[idx] = createEmptyBucket(current.timestamp + i * BUCKET_DURATION_MS);
      }
      this.currentIndex = (this.currentIndex + steps) % BUCKET_COUNT;
    } else if (steps >= BUCKET_COUNT) {
      // 已经过去了超过 24 小时，全部重置
      for (let i = 0; i < BUCKET_COUNT; i++) {
        this.buckets[i] = createEmptyBucket(0);
      }
      this.currentIndex = 0;
      this.buckets[0] = createEmptyBucket(ts);
    }

    // 确保当前桶时间戳正确
    if (this.buckets[this.currentIndex].timestamp !== ts) {
      this.buckets[this.currentIndex] = createEmptyBucket(ts);
    }
    return this.buckets[this.currentIndex];
  }
}

/** 单例导出 */
export const metricsCollector = new MetricsCollector();
