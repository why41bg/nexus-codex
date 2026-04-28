/**
 * 管理面板事件总线。
 *
 * 后端各模块（account-pool、health-check 等）在状态变化时调用 emit()，
 * SSE 端点订阅后将事件推送给所有已连接的管理面板客户端。
 *
 * 使用轻量的 EventEmitter，不引入额外依赖。
 */

import { EventEmitter } from 'node:events';

// ─── 事件类型定义 ───────────────────────────────────────────

/** 账号池槽位变化（请求开始 / 结束） */
export interface PoolChangedEvent {
  type: 'pool_changed';
}

/** 账号健康状态变化 */
export interface HealthChangedEvent {
  type: 'health_changed';
  accountId: string;
  healthy: boolean;
}

export type AdminEvent = PoolChangedEvent | HealthChangedEvent;

// ─── 单例 EventEmitter ──────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // 支持最多 100 个并发 SSE 连接

export const EVENT_NAME = 'admin';

/** 发布一个管理面板事件 */
export function emitAdminEvent(event: AdminEvent): void {
  emitter.emit(EVENT_NAME, event);
}

/** 订阅管理面板事件，返回取消订阅函数 */
export function onAdminEvent(handler: (event: AdminEvent) => void): () => void {
  emitter.on(EVENT_NAME, handler);
  return () => emitter.off(EVENT_NAME, handler);
}
