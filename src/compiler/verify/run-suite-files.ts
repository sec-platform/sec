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
  // Bind both order and absolute location before the first await. A suite or
  // reporting callback may change process.cwd(); it must not redirect a later
  // relative entry to a different file. Keep caller labels for diagnostics.
  const capturedFiles = [...files].map((file) => ({ file, moduleUrl: pathToFileURL(file) }));
  for (const { file, moduleUrl } of capturedFiles) {
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
