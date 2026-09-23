import { isProxy } from 'node:util/types';

import type { CommitFence } from '../../contracts/commit-fence.ts';

export interface FastSuiteProcessInput {
  readonly workspaceRoot: string;
  readonly suiteRoot: string;
  readonly files: readonly string[];
  readonly onSuitePassed?: (file: string) => unknown;
  readonly signal?: AbortSignal;
  readonly commitFence?: CommitFence;
  readonly workspaceInputMode?: 'live-workspace' | 'sealed-generation';
}

const MAXIMUM_SUITE_FILES = 10_000;
const MAXIMUM_PATH_CODE_UNITS = 16 * 1024;

/** Capture data before any awaited fence; accessors and proxies carry no input authority. */
export function captureFastSuiteProcessInput(input: FastSuiteProcessInput): FastSuiteProcessInput {
  if (input === null || typeof input !== 'object' || isProxy(input)) {
    throw new TypeError('Fast suite input must be an own-data object');
  }
  const field = (key: keyof FastSuiteProcessInput): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined) return undefined;
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Fast suite input ${key} must be an own data property`);
    }
    return descriptor.value;
  };
  const pathValue = (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_PATH_CODE_UNITS || value.includes('\0')) {
      throw new TypeError('Fast suite paths must be bounded non-empty strings without NUL');
    }
    return value;
  };
  const workspaceRoot = pathValue(field('workspaceRoot'));
  const suiteRoot = pathValue(field('suiteRoot'));
  const candidates = field('files');
  if (isProxy(candidates) || !Array.isArray(candidates) || candidates.length > MAXIMUM_SUITE_FILES) {
    throw new TypeError('Fast suite file inventory must be a bounded non-proxy array');
  }
  const files: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(candidates, index);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Fast suite file inventory must be dense own data');
    }
    files.push(pathValue(descriptor.value));
  }
  const onSuitePassed = field('onSuitePassed');
  const commitFence = field('commitFence');
  const signal = field('signal');
  const workspaceInputMode = field('workspaceInputMode');
  if (workspaceInputMode !== undefined
      && workspaceInputMode !== 'live-workspace'
      && workspaceInputMode !== 'sealed-generation') {
    throw new TypeError('Fast suite workspace input mode is invalid');
  }
  if (onSuitePassed !== undefined && typeof onSuitePassed !== 'function') {
    throw new TypeError('Suite pass recorder must be callable');
  }
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('Fast suite commit fence must be callable');
  }
  return Object.freeze({
    workspaceRoot,
    suiteRoot,
    files: Object.freeze(files),
    ...(onSuitePassed === undefined ? {} : { onSuitePassed: onSuitePassed as NonNullable<FastSuiteProcessInput['onSuitePassed']> }),
    ...(commitFence === undefined ? {} : { commitFence: commitFence as CommitFence }),
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
    ...(workspaceInputMode === undefined
      ? {}
      : { workspaceInputMode: workspaceInputMode as 'live-workspace' | 'sealed-generation' })
  });
}
