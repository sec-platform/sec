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
      ...(transport ? {} : {}),
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

export const defaultLogger = createLogger({ level: 'info' });
