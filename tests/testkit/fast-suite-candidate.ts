import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastSuiteProcessInput } from '../../src/adapters/verification/fast-suite-input.ts';
import { settleWorkspaceCallback } from './workspace-cleanup.ts';

/** Native suite fixtures keep independent source files and cleanup failure evidence. */
export async function withFastSuiteCandidate<T>(
  source: string,
  consume: (fixture: Readonly<{
    root: string;
    suiteRoot: string;
    file: string;
    input: FastSuiteProcessInput;
  }>) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-fast-suite-candidate-'));
  const suiteRoot = path.join(root, 'tests', 'unit');
  const file = path.join(suiteRoot, 'candidate.test.ts');
  return settleWorkspaceCallback(async () => {
    await mkdir(suiteRoot, { recursive: true });
    await writeFile(file, source, 'utf8');
    return consume({ root, suiteRoot, file, input: { workspaceRoot: root, suiteRoot, files: [file] } });
  }, () => rm(root, { recursive: true, force: true }));
}
