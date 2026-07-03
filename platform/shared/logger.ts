import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(options: { level: LogLevel; json?: boolean }): Logger {
  const transport = options.json
    ? undefined
    : pino.transport({
        target: 'pino/file',
        options: { destination: 1 },
      });

  const instance = pino(
    {
      level: options.level,
    },
    transport,
  );

  return {
    debug: (message, data) => instance.debug(data ?? {}, message),
    info: (message, data) => instance.info(data ?? {}, message),
    warn: (message, data) => instance.warn(data ?? {}, message),
    error: (message, data) => instance.error(data ?? {}, message),
  };
}

let _defaultLogger: Logger | null = null;

export function getDefaultLogger(): Logger {
  if (_defaultLogger === null) {
    _defaultLogger = createLogger({ level: 'info' });
  }
  return _defaultLogger;
}

export const defaultLogger: Logger = {
  debug: (message, data) => getDefaultLogger().debug(message, data),
  info: (message, data) => getDefaultLogger().info(message, data),
  warn: (message, data) => getDefaultLogger().warn(message, data),
  error: (message, data) => getDefaultLogger().error(message, data),
};
