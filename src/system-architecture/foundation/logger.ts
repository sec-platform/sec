import { SecError } from './contract/failure.ts';

export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error'] as const);
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
// An own toJSON hook can replace the entire record during JSON.stringify.
const RESERVED_LOG_FIELDS: ReadonlySet<string> = new Set(['level', 'time', 'msg', 'toJSON']);

function assertLogLevel(value: unknown): asserts value is LogLevel {
  if (typeof value === 'string' && LOG_LEVEL_SET.has(value)) return;
  throw new SecError(
    'LOGGING-CONFIG-001',
    `LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`,
    { value }
  );
}

/** Admit one exact external log-level value. Invalid ambient configuration is
 * rejected instead of being asserted into the domain type. */
export function resolveLogLevel(
  value: string | undefined,
  fallback: LogLevel = 'info'
): LogLevel {
  const selected = value === undefined ? fallback : value;
  assertLogLevel(selected);
  return selected;
}

/** Build the stable JSON-line record while preserving canonical fields against
 * caller-supplied metadata collisions and prototype mutation. */
export function buildJsonLogRecord(
  level: LogLevel,
  message: string,
  data: unknown,
  observedAtUnixMs: number
): JsonLogRecord {
  assertLogLevel(level);
  if (!Number.isSafeInteger(observedAtUnixMs) || observedAtUnixMs < 0) {
    throw new SecError(
      'LOGGING-RECORD-001',
      'Log record time must be a non-negative safe Unix millisecond integer',
      { observedAtUnixMs }
    );
  }

  const payload = Object.create(null) as Record<string, unknown>;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of Object.keys(data)) {
      // Filter before reading: even a getter on a reserved field must not run.
      if (!RESERVED_LOG_FIELDS.has(key)) payload[key] = (data as Record<string, unknown>)[key];
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

  function write(recordLevel: LogLevel, message: string, data: unknown): void {
    if (LEVEL_PRIORITY[recordLevel] < threshold) return;
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
