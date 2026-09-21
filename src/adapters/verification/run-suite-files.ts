import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { throwIfNativeAborted } from '../../contracts/native-abort.ts';
import { CompilerError } from '../../compiler/errors.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

// Instance-local loader cache discriminator, not a semantic verification key.
let suiteModuleRevision = 0n;

/** Capture the inventory before effects. Import, execution and pass recording
 * remain serial and are all joined. Cancellation does not turn unstarted files
 * into failed tests, nor physically terminate a module or suite already running. */
export async function runSuiteFiles(
  files: readonly string[],
  onSuitePassed?: (file: string) => unknown,
  signal?: AbortSignal
): Promise<void> {
  const root = process.cwd();
  throwIfNativeAborted(signal);
  if (onSuitePassed !== undefined && typeof onSuitePassed !== 'function') throw new TypeError('Suite pass recorder must be callable');
  if (!Array.isArray(files)) throw new TypeError('Suite file inventory must be an array');
  const capturedFiles: Array<{ file: string; moduleUrl: URL }> = [];
  const length = files.length;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(files, index);
    const file: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof file !== 'string' || file.length === 0 || file.includes('\0')) throw new TypeError('Suite files must be dense own non-empty path strings');
    capturedFiles.push({ file, moduleUrl: pathToFileURL(path.resolve(root, file)) });
  }
  for (const { file, moduleUrl } of capturedFiles) {
    throwIfNativeAborted(signal);
    moduleUrl.searchParams.set('loader', import.meta.url);
    moduleUrl.searchParams.set('revision', String(++suiteModuleRevision));
    // Bun discards file: URL queries when keying modules on both tested hosts.
    // Native paths retain the discriminator; Node keeps the standard URL form.
    // No shared cache is cleared and relative imports keep their original base.
    const specifier = typeof Bun !== 'undefined'
      ? fileURLToPath(moduleUrl) + moduleUrl.search
      : moduleUrl.href;
    const testModule = (await import(specifier)) as SuiteModule;
    throwIfNativeAborted(signal);
    const execute = testModule.runSuite;
    if (typeof execute !== 'function') throw new CompilerError('VERIFY-BUILD-002', `Test file "${file}" must export runSuite()`);
    await Reflect.apply(execute, testModule, []);
    throwIfNativeAborted(signal);
    await onSuitePassed?.(file);
    throwIfNativeAborted(signal);
  }
}
