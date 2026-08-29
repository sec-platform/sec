import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';
import { readText } from '../../workspace/files.ts';
import { compilerRoot } from '../../workspace/paths.ts';

export async function loadCanonicalBunRuntimeVersion(root = compilerRoot): Promise<string> {
  const version = (await readText(path.join(root, '.bun-version'))).trim();
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new CompilerError('IMPORT-AUTHORITY-001', '.bun-version must contain one exact Bun version');
  }
  return version;
}
