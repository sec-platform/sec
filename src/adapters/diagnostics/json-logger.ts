import { assertLogLevel, buildJsonLogRecord, logLevelAdmits, resolveLogLevel, type Logger, type LoggerOptions, type LogLevel } from '../../contracts/logging.ts';

// Lightweight synchronous JSON logger. It owns the current JSONL output
// contract and intentionally does not mirror an external logger API.
function createJsonLogger(level: LogLevel): Logger {

  function write(recordLevel: LogLevel, message: string, data: unknown): void {
    if (!logLevelAdmits(level, recordLevel)) return;
    const record = buildJsonLogRecord(recordLevel, message, data, Date.now());
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  return Object.freeze<Logger>({
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data)
  });
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level;
  assertLogLevel(level);
  return createJsonLogger(level);
}

let defaultLoggerInstance: Logger | null = null;

export function getDefaultLogger(): Logger {
  if (defaultLoggerInstance === null) {
    defaultLoggerInstance = createLogger({
      level: resolveLogLevel(process.env.LOG_LEVEL)
    });
  }
  return defaultLoggerInstance;
}

export const defaultLogger: Logger = Object.freeze<Logger>({
  debug: (message, data) => getDefaultLogger().debug(message, data),
  info: (message, data) => getDefaultLogger().info(message, data),
  warn: (message, data) => getDefaultLogger().warn(message, data),
  error: (message, data) => getDefaultLogger().error(message, data)
});
