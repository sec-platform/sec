import { pathToFileURL } from 'node:url';
import { CompilerError } from '../errors.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

// The loader module URL namespaces this instance-local cache discriminator.
// It is not a semantic revision or verification identity. BigInt cannot wrap.
let suiteModuleRevision = 0n;

/** Execute exactly the captured file inventory, serially and fail-fast. */
export async function runSuiteFiles(
  files: readonly string[],
  onSuitePassed?: (file: string) => void
): Promise<void> {
  // Capture before the first await: caller mutation must not change the set or
  // order of modules selected by this invocation.
  const capturedFiles = [...files];
  for (const file of capturedFiles) {
    const moduleUrl = pathToFileURL(file);
    moduleUrl.searchParams.set('loader', import.meta.url);
    moduleUrl.searchParams.set('revision', String(++suiteModuleRevision));
    const testModule = (await import(moduleUrl.href)) as SuiteModule;
    if (typeof testModule.runSuite !== 'function') {
      throw new CompilerError('VERIFY-BUILD-002', `Test file "${file}" must export runSuite()`);
    }
    await testModule.runSuite();
    onSuitePassed?.(file);
  }
}
