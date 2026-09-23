import path from 'node:path';
import { snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import type { PreparedWindowsRepositoryChangeObserver } from '../../../runtime-state/physical/runtime/windows-repository-change-observer.ts';
import { DEV_COMMAND_MAX_DURATION_MS, DEV_COMMAND_MAX_STDIN_BYTES } from './contract.ts';
import {
  assertIssuedTestSuiteExecutionAdmission,
  type TestSuiteExecutionAdmission
} from './test-execution-policy.ts';

interface DevCommandInputOptions {
  /** Retained ordinary-file inputs; the physical owner still validates them. */
  readonly auxiliaryOrdinaryFilePaths?: readonly string[];
  /** Narrows the existing command duration and never renews a parent deadline. */
  readonly timeoutMs?: number;
  readonly deadlineAtUnixMs?: number;
  readonly input?: Uint8Array;
  readonly signal?: AbortSignal;
  readonly workingDirectory?: string;
  /** Exact long-running suite admission; ordinary numeric timeouts never widen. */
  readonly testSuiteAdmission?: TestSuiteExecutionAdmission;
  readonly testSuiteObserver?: PreparedWindowsRepositoryChangeObserver;
}
export interface ObserveDevCommandOptions extends DevCommandInputOptions { readonly observe: true; }
interface ExecuteDevCommandOptions extends DevCommandInputOptions { readonly observe?: false; }
export type DevCommandOptions = ObserveDevCommandOptions | ExecuteDevCommandOptions;

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;

function strings(value: readonly string[], label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const length = Object.getOwnPropertyDescriptor(value, 'length')!.value as number;
  const captured: string[] = [];
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (field === undefined || !('value' in field) || typeof field.value !== 'string' || field.value.includes('\0')) {
      throw new TypeError(`${label} requires own string entries without NUL`);
    }
    captured.push(field.value);
  }
  return captured;
}

function exactEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Readonly<NodeJS.ProcessEnv> {
  const selected = new Map<string, string>();
  for (const source of [inherited, overrides]) {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError('Dev command environment must be a record');
    }
    for (const [rawKey, value] of Object.entries(source)) {
      if (rawKey.length === 0 || rawKey.includes('\0') || rawKey.includes('=')) {
        throw new TypeError('Dev command environment key is not canonical');
      }
      if (value !== undefined && (typeof value !== 'string' || value.includes('\0'))) {
        throw new TypeError('Dev command environment values must be strings without NUL');
      }
      const key = platform === 'win32' ? rawKey.toUpperCase() : rawKey;
      if (value === undefined) selected.delete(key);
      else selected.set(key, value);
    }
  }
  return Object.freeze(Object.fromEntries([...selected].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

/** Input projection only: does not retain files, issue a session or spawn work.
 * All callers of runDevCommand use this same captured input for identity and
 * execution. Original options are never consulted again after this boundary.
 */
export function captureDevCommandInput(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: DevCommandOptions | undefined,
  defaultWorkingDirectory: string
) {
  const cwd = process.cwd();
  const now = Date.now();
  const inheritedEnvironment = { ...process.env };
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw new TypeError('Dev command options must be an object');
  }
  const { observe, timeoutMs: requestedTimeout, deadlineAtUnixMs: requestedDeadline,
    input: requestedInput, signal, workingDirectory: requestedDirectory,
    auxiliaryOrdinaryFilePaths: requestedAuxiliary, testSuiteAdmission, testSuiteObserver } = options ?? {};
  if ((testSuiteAdmission === undefined) !== (testSuiteObserver === undefined)) {
    throw new Error('Dev command test suite admission and observer must be supplied together.');
  }
  if (observe !== undefined && typeof observe !== 'boolean') {
    throw new TypeError('Dev command observation mode must be boolean');
  }
  if (requestedDirectory !== undefined && (typeof requestedDirectory !== 'string' || requestedDirectory.includes('\0'))) {
    throw new TypeError('Dev command working directory must be a path string');
  }
  // Check the actual signal brand without interpreting an already-aborted signal
  // as successful cancellation. The original process owner settles cancellation.
  if (signal !== undefined) Reflect.apply(aborted, signal, []);
  if (testSuiteAdmission !== undefined) assertIssuedTestSuiteExecutionAdmission(testSuiteAdmission);
  const suiteRemaining = testSuiteAdmission === undefined
    ? null
    : testSuiteAdmission.childDeadlineAtUnixMs - now;
  const ownerCeiling = suiteRemaining === null ? DEV_COMMAND_MAX_DURATION_MS : suiteRemaining;
  const duration = requestedTimeout === undefined ? ownerCeiling : requestedTimeout;
  if (!Number.isSafeInteger(duration) || duration < 2 || duration > ownerCeiling) {
    throw new Error('Dev command timeout must be a safe integer within the owner duration ceiling.');
  }
  const ownerDeadline = now + duration;
  const parentDeadline = requestedDeadline === undefined ? ownerDeadline : requestedDeadline;
  if (!Number.isSafeInteger(parentDeadline) || !Number.isSafeInteger(ownerDeadline)) {
    throw new Error('Dev command parent deadline must be a safe integer.');
  }
  const deadlineAtUnixMs = Math.min(ownerDeadline, parentDeadline);
  const timeoutMs = deadlineAtUnixMs - now;
  if (timeoutMs < 2) throw new Error('Dev command parent deadline is exhausted.');
  const selectedArgs = Object.freeze(strings(args, 'Dev command arguments'));
  const auxiliary = strings(requestedAuxiliary === undefined ? [] : requestedAuxiliary, 'Dev command auxiliary paths')
    .map(file => path.resolve(cwd, file)).sort();
  if (new Set(auxiliary).size !== auxiliary.length) {
    throw new Error('Dev command auxiliary ordinary-file paths must be unique.');
  }
  const input = requestedInput === undefined ? undefined : snapshotByteView(requestedInput, 'Dev command stdin', DEV_COMMAND_MAX_STDIN_BYTES);
  const inputBytes = input?.byteLength ?? 0;
  return Object.freeze({
    observed: observe === true,
    args: selectedArgs,
    input,
    inputBytes,
    environment: exactEnvironment(inheritedEnvironment, env, process.platform),
    workingDirectory: path.resolve(cwd, requestedDirectory === undefined ? defaultWorkingDirectory : requestedDirectory),
    auxiliaryOrdinaryFilePaths: Object.freeze(auxiliary),
    signal,
    testSuiteAdmission,
    testSuiteObserver,
    deadlineAtUnixMs,
    timeoutMs,
    maximumNativeProcessResources: process.platform === 'win32' && input !== undefined ? 2 : 1
  });
}
