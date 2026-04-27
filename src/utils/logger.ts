import { pool } from '../services/account-pool.js';

// ─── Log levels ─────────────────────────────────────────────
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

// ─── Color support detection (zero deps, mirrors supports-color logic) ───

function detectColorSupport(): boolean {
  const env = process.env;

  // ─── 1. 显式开关（最高优先级）────────────────────────────
  // NO_COLOR 标准 (https://no-color.org)
  if (env.NO_COLOR !== undefined) return false;
  // FORCE_COLOR 标准 (https://force-color.org)
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0';

  // ─── 2. 正常 TTY 终端 ────────────────────────────────────
  if (process.stdout.isTTY) return true;

  // ─── 3. 非 TTY 但已知支持颜色的环境 ──────────────────────

  // concurrently 会通过管道接管 stdout（导致 isTTY=false），
  // 并设置 TERM=dumb + COLOR=0 来抑制子进程颜色。
  // 但它实际上会原样透传 ANSI 码到终端，所以可以安全启用颜色。
  if (env.TERM === 'dumb' && env.COLOR === '0') return true;

  // 常见 CI 环境（GitHub Actions, GitLab CI, Travis, CircleCI 等）
  if (env.CI !== undefined) {
    const knownCI = ['GITHUB_ACTIONS', 'GITEA_ACTIONS', 'TRAVIS', 'CIRCLECI', 'GITLAB_CI', 'BUILDKITE', 'DRONE'];
    if (knownCI.some((key) => env[key] !== undefined)) return true;
  }

  // TeamCity >= 9.1
  if (env.TEAMCITY_VERSION !== undefined) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION);
  }

  // COLORTERM（iTerm2, Hyper, VS Code terminal 等会设置）
  if (env.COLORTERM !== undefined) return true;

  // Windows Terminal / ConEmu
  if (env.WT_SESSION !== undefined || env.ConEmuTask !== undefined) return true;

  // TERM 探测
  const term = env.TERM ?? '';
  if (term === 'dumb') return false;
  if (/256color|truecolor|color|ansi|xterm|screen|vt100|rxvt|cygwin|linux/i.test(term)) return true;

  return false;
}

const useColor = detectColorSupport();
const useJson = process.env.LOG_FORMAT === 'json';

const ansi = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  // Level colors
  debug: useColor ? '\x1b[36m' : '',     // cyan
  info: useColor ? '\x1b[32m' : '',      // green
  warn: useColor ? '\x1b[33m' : '',      // yellow
  error: useColor ? '\x1b[31m' : '',     // red
  // Element colors
  time: useColor ? '\x1b[90m' : '',      // gray
  key: useColor ? '\x1b[36m' : '',       // cyan
  string: useColor ? '\x1b[33m' : '',    // yellow
  number: useColor ? '\x1b[35m' : '',    // magenta
  boolean: useColor ? '\x1b[35m' : '',   // magenta
  bracket: useColor ? '\x1b[90m' : '',   // gray
};

// ─── Level badge ────────────────────────────────────────────

const LEVEL_BADGES: Record<LogLevel, string> = {
  debug: `${ansi.debug}DBG${ansi.reset}`,
  info: `${ansi.info}${ansi.bold}INF${ansi.reset}`,
  warn: `${ansi.warn}${ansi.bold}WRN${ansi.reset}`,
  error: `${ansi.error}${ansi.bold}ERR${ansi.reset}`,
};

// ─── Pretty value formatter ─────────────────────────────────

function formatValue(val: unknown, depth: number = 0): string {
  if (val === null || val === undefined) return `${ansi.dim}null${ansi.reset}`;
  if (typeof val === 'string') return `${ansi.string}${val}${ansi.reset}`;
  if (typeof val === 'number') return `${ansi.number}${val}${ansi.reset}`;
  if (typeof val === 'boolean') return `${ansi.boolean}${val}${ansi.reset}`;

  if (Array.isArray(val)) {
    if (val.length === 0) return `${ansi.bracket}[]${ansi.reset}`;
    const items = val.map((v) => formatValue(v, depth + 1)).join(`${ansi.dim},${ansi.reset} `);
    return `${ansi.bracket}[${ansi.reset}${items}${ansi.bracket}]${ansi.reset}`;
  }

  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return `${ansi.bracket}{}${ansi.reset}`;

    // Flat inline format for shallow objects (depth 0); nested objects get compact display
    const parts = entries.map(
      ([k, v]) => `${ansi.key}${k}${ansi.reset}${ansi.dim}=${ansi.reset}${formatValue(v, depth + 1)}`,
    );

    return parts.join(' ');
  }

  return String(val);
}

// ─── Format timestamp ───────────────────────────────────────

function formatTime(iso: string): string {
  // Show only HH:MM:SS.mmm for compact output
  const time = iso.slice(11, 23);
  return `${ansi.time}${time}${ansi.reset}`;
}

// ─── Structured log output ──────────────────────────────────

interface LogEntry {
  level: LogLevel;
  time: string;
  msg: string;
  [key: string]: unknown;
}

function emitPretty(entry: LogEntry): void {
  const { level, time, msg, ...extra } = entry;
  const badge = LEVEL_BADGES[level];
  const timestamp = formatTime(time);
  const coloredMsg = `${ansi[level]}${msg}${ansi.reset}`;

  const extraKeys = Object.keys(extra);
  const extraStr = extraKeys.length > 0 ? ` ${formatValue(extra)}` : '';

  const line = `${timestamp} ${badge} ${coloredMsg}${extraStr}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function emitJson(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(output);
  } else if (entry.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function emit(entry: LogEntry): void {
  if (useJson) {
    emitJson(entry);
  } else {
    emitPretty(entry);
  }
}

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  emit({ level, time: new Date().toISOString(), msg, ...extra });
}

// ─── Public API ─────────────────────────────────────────────

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => log('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
};

// ─── Pool snapshot helper ───────────────────────────────────

function poolSnapshot(): Record<string, number> {
  const entries = pool.getStatus();
  const totalSlots = entries.reduce((sum, e) => sum + e.maxConcurrency, 0);
  const activeSlots = entries.reduce((sum, e) => sum + e.activeCount, 0);
  return {
    total: entries.length,
    totalSlots,
    activeSlots,
    availableSlots: totalSlots - activeSlots,
    unhealthy: entries.filter((e) => !e.healthy).length,
  };
}

// ─── Domain-specific log helpers ────────────────────────────

/**
 * 打印 HTTP 请求日志，包含方法、路径、状态码、耗时。
 * 可通过 level 参数控制日志级别，默认 info。
 */
export function logRequest(method: string, path: string, status: number, durationMs: number, level: LogLevel = 'info'): void {
  logger[level]('http request', { method, path, status, durationMs });
}

/**
 * 请求开始时：打印分配到的账号 + 池快照。
 */
export function logAcquire(accountId: string): void {
  logger.info('acquire account', { accountId, pool: poolSnapshot() });
}

/**
 * 请求结束时：打印释放的账号 + 池快照 + 耗时。
 */
export function logRelease(accountId: string, durationMs: number, error?: string): void {
  logger.info('release account', {
    accountId,
    durationMs,
    ...(error ? { error } : {}),
    pool: poolSnapshot(),
  });
}

/**
 * 排队超时后仍无可用账号（返回 429）时打印。
 */
export function logPoolExhausted(): void {
  logger.warn('pool exhausted (queue timed out)', { pool: poolSnapshot() });
}
