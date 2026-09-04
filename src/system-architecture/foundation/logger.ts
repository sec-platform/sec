import { SecError } from './contract/failure.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export type LoggerOptions = Readonly<{
  level: LogLevel;
}>;

export type JsonLogRecord = Readonly<Record<string, unknown>> & Readonly<{
  level: number;
  time: number;
  msg: string;
}>;

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

const LOG_LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS);
const RESERVED_LOG_FIELDS: ReadonlySet<string> = new Set(['level', 'time', 'msg']);

/** Admit one exact external log-level value. Invalid ambient configuration is
 * rejected instead of being asserted into the domain type. */
export function resolveLogLevel(
  value: string | undefined,
  fallback: LogLevel = 'info'
): LogLevel {
  if (value === undefined) return fallback;
  if (LOG_LEVEL_SET.has(value)) return value as LogLevel;
  throw new SecError(
    'LOGGING-CONFIG-001',
    `LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`,
    { value }
  );
}

/** Build the stable JSON-line record while preserving canonical fields against
 * caller-supplied metadata collisions and prototype mutation. */
export function buildJsonLogRecord(
  level: LogLevel,
  message: string,
  data: unknown,
  observedAtUnixMs: number
): JsonLogRecord {
  if (!Number.isSafeInteger(observedAtUnixMs) || observedAtUnixMs < 0) {
    throw new SecError(
      'LOGGING-RECORD-001',
      'Log record time must be a non-negative safe Unix millisecond integer',
      { observedAtUnixMs }
    );
  }

  const payload = Object.create(null) as Record<string, unknown>;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!RESERVED_LOG_FIELDS.has(key)) payload[key] = value;
    }
  } else if (data !== undefined) {
    payload.data = data;
  }

  payload.level = LEVEL_PRIORITY[level];
  payload.time = observedAtUnixMs;
  payload.msg = message;
  return Object.freeze(payload) as JsonLogRecord;
}

// Lightweight synchronous JSON logger. It owns the current JSONL output
// contract and intentionally does not mirror an external logger API.
function createJsonLogger(level: LogLevel): Logger {
  const threshold = LEVEL_PRIORITY[level];

  function write(priority: number, message: string, data: unknown): void {
    if (priority < threshold) return;
    const record = buildJsonLogRecord(
      priority === LEVEL_PRIORITY.debug
        ? 'debug'
        : priority === LEVEL_PRIORITY.info
          ? 'info'
          : priority === LEVEL_PRIORITY.warn
            ? 'warn'
            : 'error',
      message,
      data,
      Date.now()
    );
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  return Object.freeze({
    debug: (message, data) => write(LEVEL_PRIORITY.debug, message, data),
    info: (message, data) => write(LEVEL_PRIORITY.info, message, data),
    warn: (message, data) => write(LEVEL_PRIORITY.warn, message, data),
    error: (message, data) => write(LEVEL_PRIORITY.error, message, data)
  });
}

export function createLogger(options: LoggerOptions): Logger {
  return createJsonLogger(options.level);
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

export const defaultLogger: Logger = Object.freeze({
  debug: (message, data) => getDefaultLogger().debug(message, data),
  info: (message, data) => getDefaultLogger().info(message, data),
  warn: (message, data) => getDefaultLogger().warn(message, data),
  error: (message, data) => getDefaultLogger().error(message, data)
});
