export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// 轻量同步 JSON logger。它只拥有当前输出合同，不镜像外部 logger 的 API。
function createJsonLogger(level: LogLevel): Logger {
  const threshold = LEVEL_PRIORITY[level];

  function write(priority: number, message: string, data: unknown): void {
    if (priority < threshold) return;
    const payload: Record<string, unknown> = {
      level: priority,
      time: Date.now(),
      msg: message,
    };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      Object.assign(payload, data as Record<string, unknown>);
    } else if (data !== undefined) {
      payload.data = data;
    }
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  return {
    debug: (message, data) => write(LEVEL_PRIORITY.debug, message, data),
    info: (message, data) => write(LEVEL_PRIORITY.info, message, data),
    warn: (message, data) => write(LEVEL_PRIORITY.warn, message, data),
    error: (message, data) => write(LEVEL_PRIORITY.error, message, data),
  };
}

export function createLogger(options: { level: LogLevel; json?: boolean }): Logger {
  // options.json 保留为接口参数用于未来需要 pretty-print 的场景，当前 JSON 与非 JSON
  // 模式行为一致（都输出结构化 JSON 行）。
  void options.json;
  return createJsonLogger(options.level);
}

let _defaultLogger: Logger | null = null;

export function getDefaultLogger(): Logger {
  if (_defaultLogger === null) {
    // 允许通过 LOG_LEVEL 环境变量覆盖默认级别；测试场景可设为 'warn'/'error' 以减少 I/O 噪音。
    const level = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
    _defaultLogger = createLogger({ level });
  }
  return _defaultLogger;
}

export const defaultLogger: Logger = {
  debug: (message, data) => getDefaultLogger().debug(message, data),
  info: (message, data) => getDefaultLogger().info(message, data),
  warn: (message, data) => getDefaultLogger().warn(message, data),
  error: (message, data) => getDefaultLogger().error(message, data),
};
