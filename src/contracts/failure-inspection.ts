import { inspect } from 'node:util';
import { isNativeError, isProxy } from 'node:util/types';

const INSPECTION_DEPTH_LIMIT = 5;
const INSPECTION_NODE_LIMIT = 128;
const INSPECTION_KEY_LIMIT = 24;
const INSPECTION_STRING_LIMIT = 512;
const INSPECTION_RENDER_LIMIT = 4096;
const TRUNCATED = '… [truncated]';
const PROXY_NOT_INSPECTED = '[Proxy not inspected]';
const INSPECTION_METADATA = Symbol('Inspection metadata');

/** Build diagnostic data without passing an original object to util.inspect. */
function failurePresentation(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const project = (current: unknown, depth: number): unknown => {
    if (typeof current === 'string') {
      return current.length <= INSPECTION_STRING_LIMIT
        ? current : `${current.slice(0, INSPECTION_STRING_LIMIT)}${TRUNCATED}`;
    }
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) return current;
    if (isProxy(current)) return PROXY_NOT_INSPECTED;
    if (typeof current === 'function') return '[Function not inspected]';
    if (seen.has(current)) return '[Circular reference]';
    if (depth >= INSPECTION_DEPTH_LIMIT) return '[Depth limit]';
    if (++nodes > INSPECTION_NODE_LIMIT) return '[Node limit]';
    seen.add(current);

    const presentation: Record<string, unknown> = Object.create(null);
    const metadata: string[] = [];
    const original = current as object;
    const nativeError = isNativeError(original);
    const prototype = Object.getPrototypeOf(original);
    if (!nativeError && !Array.isArray(original) && prototype !== null && prototype !== Object.prototype) {
      metadata.push('[Prototype and possible internal details not expanded]');
    }

    // On Bun, enumerating all native Error keys materializes its lazy stack
    // before a later stack-key skip. Read known own data plus enumerable keys;
    // non-enumerable extras and symbols are deliberately not expanded here.
    const ownKeys = nativeError
      ? [...new Set(['name', 'message', 'code', 'details', 'cause', 'errors', ...Object.keys(original)])]
      : Reflect.ownKeys(original);
    if (nativeError) metadata.push('[Native Error non-enumerable extras and symbols not expanded]');
    let keys = 0;
    for (const key of ownKeys) {
      // Even asking for the native stack descriptor can materialize a lazy stack.
      if (key === 'stack') continue;
      const descriptor = Object.getOwnPropertyDescriptor(original, key);
      if (descriptor === undefined) continue;
      if (keys++ >= INSPECTION_KEY_LIMIT) {
        metadata.push(`[Key limit] ${TRUNCATED}`);
        break;
      }
      const rawName = typeof key === 'string' ? key : `[${String(key)}]`;
      const shortened = rawName.length <= INSPECTION_STRING_LIMIT
        ? rawName : `${rawName.slice(0, INSPECTION_STRING_LIMIT)}${TRUNCATED}`;
      let name = shortened;
      for (let duplicate = 2; Object.hasOwn(presentation, name); duplicate++) {
        name = `${shortened} [key collision ${duplicate}]`;
      }
      const projected = Object.hasOwn(descriptor, 'value') ? project(descriptor.value, depth + 1)
          : '[Accessor not evaluated]';
      Object.defineProperty(presentation, name, { value: projected, enumerable: true, configurable: true });
    }
    if (metadata.length > 0) {
      Object.defineProperty(presentation, INSPECTION_METADATA, { value: metadata, enumerable: true });
    }
    return presentation;
  };

  return project(value, 0);
}

export function inspectFailureValue(value: unknown): string {
  try {
    const rendered = inspect(failurePresentation(value), {
      customInspect: false, getters: false, depth: null
    });
    return rendered.length <= INSPECTION_RENDER_LIMIT
      ? rendered : `${rendered.slice(0, INSPECTION_RENDER_LIMIT - TRUNCATED.length)}${TRUNCATED}`;
  } catch {
    return '[Failure value cannot be inspected]';
  }
}

/**
 * Extract a string error code from an unknown error object.
 * Handles both `Error` instances with `code` property and plain objects.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  try {
    // Read once. Error classification must not replace the original failure
    // with a throwing accessor, Proxy trap, or revoked Proxy exception.
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Project only an owner-approved diagnostic code, without executing thrown
 * values or retaining their messages, paths, details or causes. This is not
 * recovery authority; unknown and accessor-backed codes remain UNKNOWN.
 */
export function boundedFailureCode(error: unknown, allowedCodes: ReadonlySet<string>): string {
  if (error === null || typeof error !== 'object' || isProxy(error)) return 'UNKNOWN';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  return typeof code === 'string' && allowedCodes.has(code) ? code : 'UNKNOWN';
}

/** A diagnostic projection, never a failure classifier or recovery authority.
 * Native Error messages must be own data; fallback presents only detached data.
 */
export function failureMessage(error: unknown): string {
  try {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      if (isProxy(error)) return PROXY_NOT_INSPECTED;
      if (isNativeError(error)) {
        const message = Object.getOwnPropertyDescriptor(error, 'message');
        if (message && Object.hasOwn(message, 'value') && typeof message.value === 'string') {
          return message.value;
        }
      }
    }
  } catch { /* Hostile native values remain detached from the diagnostic renderer. */ }
  return error === null || (typeof error !== 'object' && typeof error !== 'function')
    ? String(error) : inspectFailureValue(error);
}
