export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export function createLogger(options: { level: LogLevel; json?: boolean }): Logger {
  const minPriority = LOG_LEVEL_PRIORITY[options.level];
  const json = options.json ?? false;

  function log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVEL_PRIORITY[level] < minPriority) {
      return;
    }

    if (json) {
      const entry: Record<string, unknown> = {
        level,
        message,
        timestamp: new Date().toISOString()
      };
      if (data !== undefined) {
        entry.data = data;
      }
      if (level === 'error') {
        process.stderr.write(`${JSON.stringify(entry)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
      }
      return;
    }

    const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : level === 'debug' ? '[DEBUG]' : '[INFO]';
    const output = data !== undefined ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

    if (level === 'error') {
      process.stderr.write(`${output}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
  }

  return {
    debug: (message, data) => log('debug', message, data),
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, data) => log('error', message, data)
  };
}

export const defaultLogger = createLogger({ level: 'info' });
